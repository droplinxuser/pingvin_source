import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Cache } from "cache-manager";
import { Request } from "express";
import { I18nService } from "nestjs-i18n";
import { PrismaService } from "src/prisma/prisma.service";
import { MetricsService } from "src/cache/metrics.service";
import { TrendingService } from "src/cache/trending.service";
import { KeyedLock } from "src/utils/keyedLock.util";
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
  getShareCacheEpoch,
  invalidateShareData,
  invalidateShareDataCache,
  setCachedValueIfCurrent,
  shareDataCacheKey,
  shareGuardCacheKey,
} from "src/utils/cache.util";
import { readCommentVersion } from "./comment.service";
import { readVirusTotalReport } from "src/virustotal/virustotalReport.util";
import {
  getShareExpiration,
  isMemberShare,
  isShareExpired,
  isShareLimitReached,
  sumFileSizes,
} from "./share.util";

// Collapse bursts of share views into one metadata write per share. The
// returned visitor list is updated immediately; only the disk write is delayed.
const VISITOR_WRITE_DELAY_MS = 1000;
// Unlimited share views are counted in memory and persisted in batches. With a
// single SQLite connection this keeps a popular share from turning every page
// view into a write transaction; the delivered count is still immediate.
const VIEW_WRITE_DELAY_MS = 5 * 1000;
const VIEW_BASE_LIMIT = 2000;
// Keep the last persisted visitor list for recently viewed shares. A share
// link can be opened many times per minute; without this snapshot every view
// would read and parse uploader.json again after the previous batch flushed.
const VISITOR_SNAPSHOT_LIMIT = 256;
// A rolling expiration only needs to be persisted occasionally. The response
// still shows the fresh 100-day date on every visit; the database write is
// throttled per process so a popular share cannot cause an UPDATE per view.
const EXPIRATION_WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// A view-limited share checks its counter for every gallery/file request after
// the page view. Remember the value the atomic UPDATE returned for a moment so
// a 100-image share does not run 100 identical SELECTs; SQLite stays the
// authority for the next check.
const LIMITED_VIEW_CACHE_MS = 2 * 1000;
const LIMITED_VIEW_CACHE_LIMIT = 1000;

const GUARD_INCLUDE = {
  security: {
    select: {
      password: true,
      maxViews: true,
      maxDownloads: true,
      downloadCount: true,
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
  private readonly logger = new Logger(ShareStateService.name);
  private readonly visitorLock = new KeyedLock();
  private readonly pendingVisitors = new Map<string, UploaderInfo>();
  private readonly visitorSnapshots = new Map<string, UploaderInfo>();
  private readonly visitorTimers = new Map<string, NodeJS.Timeout>();
  private readonly visitorWrites = new Map<string, Promise<void>>();
  private readonly dirtyVisitors = new Set<string>();
  private readonly expirationWrites = new Map<string, number>();
  private readonly viewBaseCounts = new Map<string, number>();
  private readonly viewPendingCounts = new Map<string, number>();
  private readonly limitedViewCounts = new Map<
    string,
    { views: number; at: number }
  >();
  private viewFlushTimer?: NodeJS.Timeout;
  private viewFlush?: Promise<void>;
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
    private readonly metrics: MetricsService,
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
    const epoch = getShareCacheEpoch(id);
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
            avatarUpdatedAt: true,
          },
        },
        security: {
          select: {
            password: true,
            maxViews: true,
            maxDownloads: true,
            downloadCount: true,
          },
        },
      },
    });

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));
    if (share.removedReason)
      throw new NotFoundException(share.removedReason, "share_removed");
    if (!share.uploadLocked)
      throw new NotFoundException(this.i18n.t("share.notFound"));

    // The row already contains the counter, so seed the batched-view base and
    // skip the extra SELECT the first unlimited view would otherwise run.
    if (!this.viewPendingCounts.has(id)) this.rememberViewBase(id, share.views);

    // Refresh the rolling expiration on a cache miss, but persist it at most
    // once per six hours per share. The cached response still shows a fresh
    // 100-day date on every visit. Expired shares must not be revived by an
    // owner-management request (GET /shares/:id/from-owner) or by a late cache
    // miss: expiration is also how takedowns and reverse-share deletion work.
    const commentsVersionRead = readCommentVersion(id);
    if (isShareExpired(share.expiration)) {
      throw new NotFoundException(this.i18n.t("share.notFound"));
    }
    // Shares with the epoch expiration never expire and keep that value.
    if (share.expiration.getTime() !== 0) {
      // Never revive a share that has exhausted a hard limit. A rolling write
      // that was already in flight is also guarded by the previous-expiration
      // condition in persistExpiration(), so it cannot overwrite a burn.
      const limitReached = isShareLimitReached({
        views: share.views,
        maxViews: share.security?.maxViews,
        maxDownloads: share.security?.maxDownloads,
        downloadCount: share.security?.downloadCount,
      });
      if (!limitReached) {
        const previousExpiration = share.expiration;
        // The rolling window follows the share's owner: member shares keep 100
        // days, guest uploads expire after 10 days without a visit.
        share.expiration = getShareExpiration(isMemberShare(share));
        // The fresh expiration is already in the response. Persisting it is a
        // best-effort side effect: a transient SQLite busy/locked error must
        // not turn a valid share page into a 500.
        void this.persistExpiration(
          share.id,
          share.expiration,
          previousExpiration,
        );
      }
    }

    const { security, files, ...shareData } = share;
    const [commentsVersion, virusTotal] = await Promise.all([
      commentsVersionRead,
      readVirusTotalReport(id),
    ]);
    // Attach the flat-file scan verdict to each file so the share page can show
    // a "safe" indicator without a database column.
    const filesWithReport = files.map((file) =>
      virusTotal[file.id] ? { ...file, virustotal: virusTotal[file.id] } : file,
    );
    const result = {
      ...shareData,
      files: filesWithReport,
      size: sumFileSizes(files),
      hasPassword: !!security?.password,
      maxViews: security?.maxViews,
      maxDownloads: security?.maxDownloads,
      downloadCount: security?.downloadCount,
      commentsVersion,
    };
    await setCachedValueIfCurrent(
      this.cache,
      cacheKey,
      result,
      SHARE_DATA_CACHE_TTL_MS,
      id,
      epoch,
    );
    return result;
  }

  private async persistExpiration(
    shareId: string,
    expiration: Date,
    previousExpiration?: Date,
  ) {
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
    try {
      await this.prisma.share.updateMany({
        // Only extend the window that was read. If a limit burn (or an admin
        // takedown) changed the expiration while this update was in flight,
        // the conditional write is a no-op instead of reviving the share.
        where: previousExpiration
          ? { id: shareId, expiration: previousExpiration }
          : { id: shareId },
        data: { expiration },
      });
    } catch (error) {
      // Let the next cache miss retry instead of suppressing writes for six
      // hours after one transient failure.
      this.expirationWrites.delete(shareId);
      this.logger.warn(
        `Could not refresh the expiration of share ${shareId}: ${error}`,
      );
    }
  }

  async invalidateData(shareId: string) {
    this.visitorSnapshots.delete(shareId);
    // Persist batched views before an edit can tighten the view limit (or
    // before a deletion removes the row), then forget the local counter.
    if (this.viewPendingCounts.has(shareId)) await this.flushViews();
    // A view can arrive while the first flush is in flight; flush again before
    // dropping the local counter so a new view limit sees the real total.
    if (this.viewPendingCounts.has(shareId)) await this.flushViews();
    this.viewBaseCounts.delete(shareId);
    this.viewPendingCounts.delete(shareId);
    this.limitedViewCounts.delete(shareId);
    await Promise.all([
      this.invalidateDataCache(shareId),
      this.trending.invalidate(shareId),
    ]);
  }

  /**
   * Comments only change the share payload's `commentsVersion`; security and
   * SEO data stay valid. Invalidating just the share data keeps those cache
   * entries (and their database loads) from being rebuilt on a comment edit.
   */
  async invalidateCommentsData(shareId: string) {
    await invalidateShareData(this.cache, shareId);
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
    const epoch = getShareCacheEpoch(shareId);
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: GUARD_INCLUDE,
    });

    if (!share || share.removedReason || !share.uploadLocked) return null;

    await setCachedValueIfCurrent(
      this.cache,
      key,
      share,
      SHARE_DATA_CACHE_TTL_MS,
      shareId,
      epoch,
    );
    return share;
  }

  async shareExists(shareId: string): Promise<boolean> {
    const share = await this.getGuardShare(shareId);
    return !!share && !isShareExpired(share.expiration);
  }

  async getCurrentViews(shareId: string): Promise<number> {
    // A view-limited share just wrote the exact counter on the page view;
    // reuse it for the file requests that follow instead of one SELECT each.
    const limited = this.limitedViewCounts.get(shareId);
    if (limited && Date.now() - limited.at < LIMITED_VIEW_CACHE_MS)
      return limited.views;

    // Include batched views so a share that was just switched to a view limit
    // is not enforced against a stale database counter.
    const pending = this.viewPendingCounts.get(shareId);
    if (pending !== undefined)
      return (this.viewBaseCounts.get(shareId) ?? 0) + pending;

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { views: true },
    });
    if (share) this.rememberLimitedView(shareId, share.views);
    return share?.views ?? 0;
  }

  async recordView(id: string, request: Request, maxViews?: number | null) {
    const views = maxViews
      ? await this.recordLimitedView(id, maxViews)
      : await this.recordUnlimitedView(id);

    const uploaderInfo = await this.recordVisitor(id, request);
    return { views, uploaderInfo };
  }

  /**
   * The common case has no view limit, so views are counted in memory and one
   * conditional UPDATE per flush window persists the whole batch. The base
   * counter is read once per share, then corrected from the value SQLite
   * returns on every flush.
   */
  private async recordUnlimitedView(id: string): Promise<number> {
    let base = this.viewBaseCounts.get(id);
    if (base === undefined) {
      const share = await this.prisma.share.findUnique({
        where: { id },
        select: { views: true },
      });
      if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));
      base = share.views;
      this.rememberViewBase(id, base);
    }

    const pending = (this.viewPendingCounts.get(id) ?? 0) + 1;
    this.viewPendingCounts.set(id, pending);
    this.scheduleViewFlush();
    return base + pending;
  }

  private rememberLimitedView(id: string, views: number) {
    if (
      !this.limitedViewCounts.has(id) &&
      this.limitedViewCounts.size >= LIMITED_VIEW_CACHE_LIMIT
    )
      this.limitedViewCounts.clear();
    this.limitedViewCounts.set(id, { views, at: Date.now() });
  }

  private rememberViewBase(id: string, views: number) {
    if (
      !this.viewBaseCounts.has(id) &&
      this.viewBaseCounts.size >= VIEW_BASE_LIMIT
    ) {
      // Only drop counters with nothing waiting to be written; a dropped
      // counter is simply re-read from SQLite on the next view.
      for (const key of this.viewBaseCounts.keys()) {
        if (this.viewPendingCounts.has(key)) continue;
        this.viewBaseCounts.delete(key);
        if (this.viewBaseCounts.size < VIEW_BASE_LIMIT / 2) break;
      }
    }
    this.viewBaseCounts.set(id, views);
  }

  private scheduleViewFlush() {
    if (this.shuttingDown || this.viewFlushTimer) return;
    const timer = setTimeout(() => {
      this.viewFlushTimer = undefined;
      void this.flushViews();
    }, VIEW_WRITE_DELAY_MS);
    timer.unref();
    this.viewFlushTimer = timer;
  }

  /**
   * Persists the pending increments. The base is raised optimistically before
   * the write so a view that arrives during the flush is counted correctly;
   * the value returned by SQLite replaces it afterwards.
   */
  private async flushViews(): Promise<void> {
    if (this.viewFlush) return this.viewFlush;

    const batch: [string, number][] = [...this.viewPendingCounts];
    if (batch.length === 0) return;
    this.viewPendingCounts.clear();
    for (const [id, count] of batch)
      this.viewBaseCounts.set(id, (this.viewBaseCounts.get(id) ?? 0) + count);

    const write = (async () => {
      await Promise.all(
        batch.map(async ([id, count]) => {
          try {
            const share = await this.prisma.share.update({
              where: { id },
              data: { views: { increment: count } },
              select: { views: true },
            });
            this.viewBaseCounts.set(id, share.views);
          } catch (error) {
            // Put the unpersisted views back so the next flush retries them.
            this.viewBaseCounts.set(
              id,
              Math.max(0, (this.viewBaseCounts.get(id) ?? count) - count),
            );
            this.viewPendingCounts.set(
              id,
              (this.viewPendingCounts.get(id) ?? 0) + count,
            );
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2025"
            ) {
              this.viewBaseCounts.delete(id);
              this.viewPendingCounts.delete(id);
            }
          }
        }),
      );
    })();

    this.viewFlush = write;
    try {
      await write;
    } finally {
      this.viewFlush = undefined;
    }
    if (this.viewPendingCounts.size > 0) this.scheduleViewFlush();
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
    if (rows.length > 0) {
      const views = Number(rows[0].views);
      this.rememberLimitedView(id, views);
      return views;
    }

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

  private async recordVisitor(
    shareId: string,
    request: Request,
  ): Promise<UploaderInfo> {
    return this.visitorLock.run(shareId, async () => {
      let info =
        this.pendingVisitors.get(shareId) ?? this.visitorSnapshots.get(shareId);
      if (!info) {
        info = (await readUploaderInfo(shareId)) ?? {
          createdAt: new Date().toISOString(),
        };
      }

      const visitor = getVisitorInfo(request);
      // Aggregate the external referrer domain for the admin dashboard. This
      // is fire-and-forget: a cache hiccup must not delay the share response.
      if (visitor.referrer)
        void this.metrics.recordReferrer(visitor.referrer).catch(() => {});
      info.visitors = [...(info.visitors ?? []), visitor].slice(-MAX_VISITORS);
      this.pendingVisitors.set(shareId, info);
      this.queueVisitorWrite(shareId);
      return info;
    });
  }

  private rememberVisitorSnapshot(shareId: string, info: UploaderInfo) {
    // Refresh the insertion order so the oldest clean snapshot is evicted.
    this.visitorSnapshots.delete(shareId);
    this.visitorSnapshots.set(shareId, info);
    if (this.visitorSnapshots.size <= VISITOR_SNAPSHOT_LIMIT) return;

    const oldest = this.visitorSnapshots.keys().next().value;
    if (oldest) this.visitorSnapshots.delete(oldest);
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
      this.rememberVisitorSnapshot(shareId, info);
    }
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;
    if (this.viewFlushTimer) clearTimeout(this.viewFlushTimer);
    this.viewFlushTimer = undefined;
    if (this.viewFlush) await this.viewFlush.catch(() => {});
    if (this.viewPendingCounts.size > 0)
      await this.flushViews().catch(() => {});

    for (const timer of this.visitorTimers.values()) clearTimeout(timer);
    this.visitorTimers.clear();

    // Let older snapshots finish first; otherwise one could overwrite the
    // final write below after this hook resolves.
    await Promise.all([...this.visitorWrites.values()]);

    // Clean snapshots are already on disk; only unflushed views need a write.
    const pending = [...this.pendingVisitors].filter(([shareId]) =>
      this.dirtyVisitors.has(shareId),
    );
    this.pendingVisitors.clear();
    this.visitorSnapshots.clear();
    this.visitorWrites.clear();
    this.dirtyVisitors.clear();
    await Promise.all(
      pending.map(([shareId, info]) => writeUploaderInfo(shareId, info)),
    );
  }
}
