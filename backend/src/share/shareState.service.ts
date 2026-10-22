import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Cache } from "cache-manager";
import { Request } from "express";
import * as moment from "moment";
import { I18nService } from "nestjs-i18n";
import { PrismaService } from "src/prisma/prisma.service";
import { getDefaultShareExpiration } from "src/utils/date.util";
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
  shareExistsCacheKey,
  shareGuardCacheKey,
} from "src/utils/cache.util";
import { ShareWriteBufferService } from "src/cache/shareWriteBuffer.service";

const GUARD_INCLUDE = {
  security: true,
  reverseShare: true,
  userRecipients: { select: { userId: true } },
  recipients: { select: { email: true } },
} satisfies Prisma.ShareInclude;

export type GuardShare = Prisma.ShareGetPayload<{
  include: typeof GUARD_INCLUDE;
}>;

@Injectable()
export class ShareStateService implements OnApplicationShutdown {
  private readonly visitorLocks = new Map<string, Promise<void>>();
  private readonly pendingUploaderWrites = new Map<string, UploaderInfo>();
  private readonly uploaderWriteTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly shareWrites: ShareWriteBufferService,
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

    // Refresh the rolling expiration on a cache miss. The new value is queued
    // in Valkey and written to SQLite with the other buffered share updates.
    if (!moment(share.expiration).isSame(0)) {
      share.expiration = getDefaultShareExpiration();
      await this.shareWrites.queueExpiration(id, share.expiration);
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
    await invalidateShareDataCache(this.cache, shareId);
  }

  async getGuardShare(shareId: string): Promise<GuardShare | null> {
    const key = shareGuardCacheKey(shareId);
    const cached = await getCachedValue<GuardShare>(this.cache, key);
    if (cached) return cached;

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: GUARD_INCLUDE,
    });
    if (share)
      await setCachedValue(this.cache, key, share, SHARE_DATA_CACHE_TTL_MS);
    return share;
  }

  async shareExists(shareId: string): Promise<boolean> {
    const key = shareExistsCacheKey(shareId);
    const cached = await getCachedValue<boolean>(this.cache, key);
    if (cached) return cached;

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { id: true },
    });
    if (share)
      await setCachedValue(this.cache, key, true, SHARE_DATA_CACHE_TTL_MS);
    return !!share;
  }

  async getCurrentViews(shareId: string, dbViews: number): Promise<number> {
    return this.shareWrites.getViews(shareId, dbViews);
  }

  async clear(shareId: string) {
    const timer = this.uploaderWriteTimers.get(shareId);
    if (timer) clearTimeout(timer);
    this.uploaderWriteTimers.delete(shareId);
    this.pendingUploaderWrites.delete(shareId);
    await Promise.all([
      invalidateShareDataCache(this.cache, shareId),
      this.shareWrites.clear(shareId),
    ]);
  }

  async recordView(
    id: string,
    request: Request,
    dbViews: number,
    maxViews?: number | null,
  ) {
    const result = await this.shareWrites.recordView(id, dbViews, maxViews);
    if (result.status === "missing")
      throw new NotFoundException(this.i18n.t("share.notFound"));
    if (result.status === "limit")
      throw new ForbiddenException(
        this.i18n.t("share.maxViewsExceeded"),
        "share_max_views_exceeded",
      );

    const uploaderInfo = await this.recordVisitor(id, request);
    delete uploaderInfo.views;

    return { views: result.views, uploaderInfo };
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
      // Read the pending copy first so visitors recorded during the 5s write
      // debounce are not lost.
      const info = this.pendingUploaderWrites.get(shareId) ??
        (await readUploaderInfo(shareId)) ?? {
          createdAt: new Date().toISOString(),
        };
      info.visitors = [...(info.visitors ?? []), getVisitorInfo(request)].slice(
        -MAX_VISITORS,
      );

      this.queueUploaderInfoWrite(shareId, info);
      return info;
    });
  }

  private queueUploaderInfoWrite(shareId: string, info: UploaderInfo) {
    this.pendingUploaderWrites.set(shareId, info);
    if (this.uploaderWriteTimers.has(shareId)) return;

    const timer = setTimeout(() => {
      this.uploaderWriteTimers.delete(shareId);
      void this.flushUploaderInfo(shareId);
    }, 5000);
    timer.unref?.();
    this.uploaderWriteTimers.set(shareId, timer);
  }

  private async flushUploaderInfo(shareId: string) {
    const info = this.pendingUploaderWrites.get(shareId);
    if (!info) return;

    this.pendingUploaderWrites.delete(shareId);
    await writeUploaderInfo(shareId, info);
  }

  async onApplicationShutdown() {
    for (const timer of this.uploaderWriteTimers.values()) clearTimeout(timer);
    this.uploaderWriteTimers.clear();

    await Promise.all(
      [...this.pendingUploaderWrites.keys()].map((id) =>
        this.flushUploaderInfo(id),
      ),
    );
  }
}
