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
import { SHARE_EXPIRATION, sumFileSizes } from "./share.util";

// Collapse bursts of share views into one metadata write per share. The
// returned visitor list is updated immediately; only the disk write is delayed.
const VISITOR_WRITE_DELAY_MS = 1000;
// A rolling expiration only needs to be persisted occasionally. The response
// still shows the fresh 100-day date on every visit; the database write is
// throttled per process so a popular share cannot cause an UPDATE per view.
const EXPIRATION_WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
export class ShareStateService implements OnApplicationShutdown {
  private readonly visitorLocks = new Map<string, Promise<void>>();
  private readonly pendingVisitors = new Map<string, UploaderInfo>();
  private readonly visitorTimers = new Map<string, NodeJS.Timeout>();
  private readonly visitorWrites = new Map<string, Promise<void>>();
  private readonly dirtyVisitors = new Set<string>();
  private readonly expirationWrites = new Map<string, number>();
  private readonly pendingShareLoads = new Map<
    string,
    Promise<Record<string, unknown>>
  >();
  private readonly pendingGuardLoads = new Map<
    string,
    Promise<GuardShare | null>
  >();
  private shuttingDown = false;

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

    // A cold share page is requested by the HTML shell and the client API at
    // nearly the same time. Reuse the in-flight load so both requests share one
    // database read instead of racing to fill the cache.
    const pending = this.pendingShareLoads.get(id);
    if (pending) return pending;

    const load = this.loadShare(id, cacheKey);
    this.pendingShareLoads.set(id, load);
    void load
      .finally(() => {
        if (this.pendingShareLoads.get(id) === load)
          this.pendingShareLoads.delete(id);
      })
      .catch(() => {});
    return load;
  }

  private async loadShare(
    id: string,
    cacheKey: string,
  ): Promise<Record<string, unknown>> {
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

    // Refresh the rolling expiration on a cache miss, but persist it at most
    // once per six hours per share. The cached response still shows a fresh
    // 100-day date on every visit.
    if (!moment(share.expiration).isSame(0)) {
      share.expiration = parseRelativeDateToAbsolute(SHARE_EXPIRATION);
      await this.persistExpiration(share.id, share.expiration);
    }

    const { security, ...shareData } = share;
    const result = {
      ...shareData,
      size: sumFileSizes(share.files),
      hasPassword: !!security?.password,
      maxViews: security?.maxViews,
    };
    await setCachedValue(this.cache, cacheKey, result, SHARE_DATA_CACHE_TTL_MS);
    return result;
  }

  private async persistExpiration(shareId: string, expiration: Date) {
    const now = Date.now();
    const lastWrite = this.expirationWrites.get(shareId) ?? 0;
    if (now - lastWrite < EXPIRATION_WRITE_INTERVAL_MS) return;

    // Keep the map bounded on a long-running instance without scanning it on
    // every share read.
    if (this.expirationWrites.size > 1000) {
      for (const [id, writtenAt] of this.expirationWrites) {
        if (now - writtenAt >= EXPIRATION_WRITE_INTERVAL_MS)
          this.expirationWrites.delete(id);
      }
    }

    // Record the attempt before awaiting so concurrent cache misses for the
    // same share cannot queue duplicate UPDATEs.
    this.expirationWrites.set(shareId, now);
    await this.prisma.share.updateMany({
      where: { id: shareId },
      data: { expiration },
    });
  }

  async invalidateData(shareId: string) {
    await Promise.all([
      this.invalidateDataCache(shareId),
      this.trending.invalidate(shareId),
    ]);
  }

  async invalidateDataCache(shareId: string) {
    await invalidateShareDataCache(this.cache, shareId);
  }

  async getGuardShare(shareId: string): Promise<GuardShare | null> {
    const key = shareGuardCacheKey(shareId);
    const cached = await getCachedValue<GuardShare>(this.cache, key);
    if (cached) return cached;

    const pending = this.pendingGuardLoads.get(shareId);
    if (pending) return pending;

    const load = this.loadGuardShare(shareId, key);
    this.pendingGuardLoads.set(shareId, load);
    void load
      .finally(() => {
        if (this.pendingGuardLoads.get(shareId) === load)
          this.pendingGuardLoads.delete(shareId);
      })
      .catch(() => {});
    return load;
  }

  private async loadGuardShare(
    shareId: string,
    key: string,
  ): Promise<GuardShare | null> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: GUARD_INCLUDE,
    });

    if (!share || share.removedReason || !share.uploadLocked) return null;

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
    // One conditional UPDATE makes the limit check and increment atomic, so
    // two concurrent requests cannot both observe the last permitted view.
    // SQLite returns the new counter, avoiding the old read-then-write query.
    const rows = await this.prisma.$queryRaw<{ views: number | bigint }[]>`
      UPDATE "Share"
      SET "views" = "views" + 1
      WHERE "id" = ${id} AND "views" < ${maxViews}
      RETURNING "views"
    `;
    if (rows.length > 0) return Number(rows[0].views);

    // No row updated: either the share is gone or the limit is exhausted.
    const share = await this.prisma.share.findUnique({
      where: { id },
      select: { views: true },
    });
    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));
    throw new ForbiddenException(
      this.i18n.t("share.maxViewsExceeded"),
      "share_max_views_exceeded",
    );
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
      let info = this.pendingVisitors.get(shareId);
      if (!info) {
        info = (await readUploaderInfo(shareId)) ?? {
          createdAt: new Date().toISOString(),
        };
        this.pendingVisitors.set(shareId, info);
      }

      info.visitors = [...(info.visitors ?? []), getVisitorInfo(request)].slice(
        -MAX_VISITORS,
      );
      this.queueVisitorWrite(shareId);
      return info;
    });
  }

  private queueVisitorWrite(shareId: string) {
    this.dirtyVisitors.add(shareId);
    if (this.shuttingDown || this.visitorTimers.has(shareId)) return;

    const timer = setTimeout(
      () => void this.flushVisitorInfo(shareId),
      VISITOR_WRITE_DELAY_MS,
    );
    timer.unref();
    this.visitorTimers.set(shareId, timer);
  }

  private async flushVisitorInfo(shareId: string) {
    this.visitorTimers.delete(shareId);
    if (!this.dirtyVisitors.delete(shareId)) return;

    const info = this.pendingVisitors.get(shareId);
    if (!info) return;

    const write = writeUploaderInfo(shareId, info);
    this.visitorWrites.set(shareId, write);
    await write;
    if (this.visitorWrites.get(shareId) === write)
      this.visitorWrites.delete(shareId);

    // A view that arrived during the write is kept for the next flush instead
    // of being dropped from the on-disk visitor list.
    if (this.dirtyVisitors.has(shareId)) {
      this.queueVisitorWrite(shareId);
    } else if (this.pendingVisitors.get(shareId) === info) {
      this.pendingVisitors.delete(shareId);
    }
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;
    for (const timer of this.visitorTimers.values()) clearTimeout(timer);
    this.visitorTimers.clear();

    // Let older snapshots finish first; otherwise one could overwrite the
    // final write below after this hook resolves.
    await Promise.all([...this.visitorWrites.values()]);

    const pending = [...this.pendingVisitors];
    this.pendingVisitors.clear();
    this.visitorWrites.clear();
    this.dirtyVisitors.clear();
    await Promise.all(
      pending.map(([shareId, info]) => writeUploaderInfo(shareId, info)),
    );
  }
}
