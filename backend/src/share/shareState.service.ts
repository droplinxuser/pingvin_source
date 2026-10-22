import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationShutdown,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
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
  SHARE_UPLOADER_CACHE_TTL_MS,
  getCachedValue,
  invalidateShareCaches,
  invalidateShareDataCache,
  setCachedValue,
  shareDataCacheKey,
  shareUploaderCacheKey,
} from "src/utils/shareCache.util";

@Injectable()
export class ShareStateService implements OnApplicationShutdown {
  private readonly visitorLocks = new Map<string, Promise<void>>();
  private readonly pendingUploaderWrites = new Map<string, UploaderInfo>();
  private readonly uploaderWriteTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    private readonly i18n: I18nService,
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

    // Refresh the rolling expiration only on a cache miss to avoid a SQLite
    // write for every visit.
    if (!moment(share.expiration).isSame(0)) {
      share.expiration = getDefaultShareExpiration();
      await this.prisma.share.update({
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
    await setCachedValue(
      this.cache,
      cacheKey,
      result,
      SHARE_DATA_CACHE_TTL_MS,
    );
    return result;
  }

  async invalidateData(shareId: string) {
    await invalidateShareDataCache(this.cache, shareId);
  }

  async clear(shareId: string) {
    const timer = this.uploaderWriteTimers.get(shareId);
    if (timer) clearTimeout(timer);
    this.uploaderWriteTimers.delete(shareId);
    this.pendingUploaderWrites.delete(shareId);
    await invalidateShareCaches(this.cache, shareId);
  }

  async recordView(
    id: string,
    request: Request,
    maxViews?: number | null,
  ) {
    let updated: { views: number };
    try {
      updated = await this.prisma.share.update({
        where: maxViews ? { id, views: { lt: maxViews } } : { id },
        data: { views: { increment: 1 } },
        select: { views: true },
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        const exists = await this.prisma.share.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!exists)
          throw new NotFoundException(this.i18n.t("share.notFound"));
        throw new ForbiddenException(
          this.i18n.t("share.maxViewsExceeded"),
          "share_max_views_exceeded",
        );
      }
      throw error;
    }

    const uploaderInfo = await this.recordVisitor(id, request);
    delete uploaderInfo.views;

    return { views: updated.views, uploaderInfo };
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

  private async loadUploaderInfo(shareId: string): Promise<UploaderInfo | null> {
    const key = shareUploaderCacheKey(shareId);
    const cached = await getCachedValue<UploaderInfo>(this.cache, key);
    if (cached) return cached;

    const info = await readUploaderInfo(shareId);
    if (info)
      await setCachedValue(
        this.cache,
        key,
        info,
        SHARE_UPLOADER_CACHE_TTL_MS,
      );
    return info;
  }

  private async recordVisitor(
    shareId: string,
    request: Request,
  ): Promise<UploaderInfo> {
    return this.withVisitorLock(shareId, async () => {
      const info = (await this.loadUploaderInfo(shareId)) ?? {
        createdAt: new Date().toISOString(),
      };
      info.visitors = [...(info.visitors ?? []), getVisitorInfo(request)].slice(
        -MAX_VISITORS,
      );

      await setCachedValue(
        this.cache,
        shareUploaderCacheKey(shareId),
        info,
        SHARE_UPLOADER_CACHE_TTL_MS,
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
    for (const timer of this.uploaderWriteTimers.values())
      clearTimeout(timer);
    this.uploaderWriteTimers.clear();

    await Promise.all(
      [...this.pendingUploaderWrites.keys()].map((id) =>
        this.flushUploaderInfo(id),
      ),
    );
  }
}
