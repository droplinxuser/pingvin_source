import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Cache } from "cache-manager";
import { Request } from "express";
import * as moment from "moment";
import { I18nService } from "nestjs-i18n";
import { PrismaService } from "src/prisma/prisma.service";
import { TrendingService } from "src/cache/trending.service";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";
import {
  MAX_VISITORS,
  getVisitorInfo,
  readUploaderInfo,
  UploaderInfo,
  writeUploaderInfo,
} from "src/utils/uploaderInfo.util";
import {
  SHARE_DATA_CACHE_TTL_MS,
  getCachedValue,
  invalidateShareDataCache,
  setCachedValue,
  shareDataCacheKey,
  shareGuardCacheKey,
} from "src/utils/cache.util";
import { SHARE_EXPIRATION, isViewLimitExceeded } from "./share.util";

const GUARD_INCLUDE = {
  security: {
    select: {
      password: true,
      maxViews: true,
      restrictToRecipients: true,
    },
  },
  // Only the visibility check needs the reverse share, not its token.
  reverseShare: { select: { publicAccess: true, creatorId: true } },
  userRecipients: { select: { userId: true } },
  recipients: { select: { email: true } },
} satisfies Prisma.ShareInclude;

export type GuardShare = Prisma.ShareGetPayload<{
  include: typeof GUARD_INCLUDE;
}>;

@Injectable()
export class ShareStateService {
  private readonly visitorLocks = new Map<string, Promise<void>>();

  constructor(
    private prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly trending: TrendingService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getShare(id: string): Promise<Record<string, unknown>> {
    const cacheKey = shareDataCacheKey(id);
    const cached = await getCachedValue<Record<string, unknown>>(
      this.cache,
      cacheKey,
    );
    if (cached) return cached;

    const share = await this.prisma.share.findUnique({
      where: { id },
      include: {
        files: {
          select: { id: true, name: true, size: true },
          orderBy: {
            name: "asc",
          },
        },
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            shareSizeLimit: true,
          },
        },
        security: {
          select: {
            password: true,
            maxViews: true,
          },
        },
      },
    });

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));
    if (share.removedReason)
      throw new NotFoundException(share.removedReason, "share_removed");
    if (!share.uploadLocked)
      throw new NotFoundException(this.i18n.t("share.notFound"));

    // Refresh the rolling expiration on a cache miss. A cached share is served
    // for 30 seconds, so this writes at most once per cache window.
    if (!moment(share.expiration).isSame(0)) {
      share.expiration = parseRelativeDateToAbsolute(SHARE_EXPIRATION);
      await this.prisma.share.updateMany({
        where: { id },
        data: { expiration: share.expiration },
      });
    }

    const { security, ...shareData } = share;
    const result = {
      ...shareData,
      hasPassword: !!security?.password,
      maxViews: security?.maxViews,
    };
    await setCachedValue(this.cache, cacheKey, result, SHARE_DATA_CACHE_TTL_MS);
    return result;
  }

  async invalidateData(shareId: string) {
    await Promise.all([
      invalidateShareDataCache(this.cache, shareId),
      this.trending.invalidate(shareId),
    ]);
  }

  async getGuardShare(shareId: string): Promise<GuardShare | null> {
    const key = shareGuardCacheKey(shareId);
    const cached = await getCachedValue<GuardShare>(this.cache, key);
    const share =
      cached ??
      (await this.prisma.share.findUnique({
        where: { id: shareId },
        include: GUARD_INCLUDE,
      }));

    if (!share || share.removedReason || !share.uploadLocked) return null;

    if (!cached)
      await setCachedValue(this.cache, key, share, SHARE_DATA_CACHE_TTL_MS);
    return share;
  }

  async shareExists(shareId: string): Promise<boolean> {
    const share = await this.getGuardShare(shareId);
    return (
      !!share &&
      (moment(share.expiration).isSame(0) ||
        !moment().isAfter(share.expiration))
    );
  }

  async getCurrentViews(shareId: string): Promise<number> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { views: true },
    });
    return share?.views ?? 0;
  }

  async recordView(id: string, request: Request, maxViews?: number | null) {
    const views = maxViews
      ? await this.recordLimitedView(id, maxViews)
      : await this.recordUnlimitedView(id);

    const uploaderInfo = await this.recordVisitor(id, request);
    return { views, uploaderInfo };
  }

  // The common case has no view limit, so a single atomic update is enough.
  private async recordUnlimitedView(id: string): Promise<number> {
    try {
      const share = await this.prisma.share.update({
        where: { id },
        data: { views: { increment: 1 } },
        select: { views: true },
      });
      return share.views;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(this.i18n.t("share.notFound"));
      }
      throw error;
    }
  }

  private async recordLimitedView(
    id: string,
    maxViews: number,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const share = await tx.share.findUnique({
        where: { id },
        select: { views: true },
      });

      if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));
      if (isViewLimitExceeded(share.views, maxViews)) {
        throw new ForbiddenException(
          this.i18n.t("share.maxViewsExceeded"),
          "share_max_views_exceeded",
        );
      }

      const updated = await tx.share.update({
        where: { id },
        data: { views: { increment: 1 } },
        select: { views: true },
      });
      return updated.views;
    });
  }

  private withVisitorLock<T>(
    shareId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.visitorLocks.get(shareId) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.visitorLocks.set(shareId, tail);
    void tail.then(() => {
      if (this.visitorLocks.get(shareId) === tail)
        this.visitorLocks.delete(shareId);
    });

    return result;
  }

  private async recordVisitor(
    shareId: string,
    request: Request,
  ): Promise<UploaderInfo> {
    return this.withVisitorLock(shareId, async () => {
      const info = (await readUploaderInfo(shareId)) ?? {
        createdAt: new Date().toISOString(),
      };
      info.visitors = [...(info.visitors ?? []), getVisitorInfo(request)].slice(
        -MAX_VISITORS,
      );

      await writeUploaderInfo(shareId, info);
      return info;
    });
  }
}
