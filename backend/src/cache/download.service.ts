import { Injectable } from "@nestjs/common";
import { ValkeyClient, ValkeyService } from "./valkey.service";

// One small hash per share per day, so reading a share's counters never scans
// unrelated shares the way a single global hash would. The window matches the
// trending/search 30-day horizon and every key expires on its own.
const DOWNLOAD_KEY_PREFIX = "pingvin:downloads:day:";
const WINDOW_DAYS = 30;
const BUCKET_TTL_SECONDS = (WINDOW_DAYS + 1) * 24 * 60 * 60;
const TOTAL_FIELD = "total";
// The share payload is read on every view, so a short in-process cache removes
// the 30-bucket read from the hot path. It is dropped on every new download so
// the owner sees their own action immediately.
const READ_CACHE_MS = 20 * 1000;
const READ_CACHE_MAX = 2000;
// Bound the in-process fallback so a long Valkey outage cannot grow memory.
const MEMORY_SHARE_LIMIT = 5000;

export type ShareDownloadStats = {
  total: number;
  files: Record<string, number>;
};

type DayBucket = { total: number; files: Map<string, number> };

/**
 * Ephemeral download counters. Per the fork's "Valkey first" rule these live in
 * Valkey (hourly/daily buckets with a TTL), not as SQLite columns, so upstream
 * schema merges stay clean. Every method degrades to a bounded in-process map
 * when Valkey is unavailable.
 */
@Injectable()
export class DownloadService {
  private readonly memory = new Map<string, Map<number, DayBucket>>();
  private readonly readCache = new Map<
    string,
    { at: number; value: ShareDownloadStats }
  >();

  constructor(private readonly valkey: ValkeyService) {}

  /**
   * Counts one download of a share, optionally attributed to the specific files
   * it contained (a single-file download passes one id, a ZIP its members).
   */
  async recordDownload(shareId: string, fileIds: string[] = []): Promise<void> {
    const day = currentDay();
    const stored = await this.valkey.run(async (client) => {
      const key = bucketKey(day, shareId);
      const multi = client.multi();
      multi.hIncrBy(key, TOTAL_FIELD, 1);
      for (const fileId of fileIds) multi.hIncrBy(key, fileId, 1);
      multi.expire(key, BUCKET_TTL_SECONDS);
      await multi.exec();
      return true;
    });

    if (!stored) {
      const byShare = this.memory.get(shareId) ?? new Map<number, DayBucket>();
      const bucket = byShare.get(day) ?? { total: 0, files: new Map() };
      bucket.total++;
      for (const fileId of fileIds)
        bucket.files.set(fileId, (bucket.files.get(fileId) ?? 0) + 1);
      byShare.set(day, bucket);

      const oldest = day - WINDOW_DAYS;
      for (const trackedDay of byShare.keys())
        if (trackedDay <= oldest) byShare.delete(trackedDay);

      this.memory.set(shareId, byShare);
      if (this.memory.size > MEMORY_SHARE_LIMIT) {
        const oldestShare = this.memory.keys().next().value;
        if (oldestShare) this.memory.delete(oldestShare);
      }
    }

    // Drop the cached read so the next fetch reflects this download.
    this.readCache.delete(shareId);
  }

  /** Rolling download totals for a share and each of its files. */
  async getShareDownloads(shareId: string): Promise<ShareDownloadStats> {
    const cached = this.readCache.get(shareId);
    if (cached && Date.now() - cached.at < READ_CACHE_MS) return cached.value;

    const remote = await this.valkey.run((client) =>
      this.readValkey(client, shareId),
    );
    const value = remote ?? this.readMemory(shareId);

    if (this.readCache.size >= READ_CACHE_MAX) {
      const oldest = this.readCache.keys().next().value;
      if (oldest) this.readCache.delete(oldest);
    }
    this.readCache.set(shareId, { at: Date.now(), value });
    return value;
  }

  private async readValkey(
    client: ValkeyClient,
    shareId: string,
  ): Promise<ShareDownloadStats> {
    const day = currentDay();
    const multi = client.multi();
    for (let offset = 0; offset < WINDOW_DAYS; offset++)
      multi.hGetAll(bucketKey(day - offset, shareId));

    const buckets = (await multi.exec()) as unknown as (Record<
      string,
      string
    > | null)[];
    return aggregate(buckets);
  }

  private readMemory(shareId: string): ShareDownloadStats {
    const result: ShareDownloadStats = { total: 0, files: {} };
    const byShare = this.memory.get(shareId);
    if (!byShare) return result;

    const oldest = currentDay() - WINDOW_DAYS;
    for (const [day, bucket] of byShare) {
      if (day <= oldest) continue;
      result.total += bucket.total;
      for (const [fileId, count] of bucket.files)
        result.files[fileId] = (result.files[fileId] ?? 0) + count;
    }
    return result;
  }
}

function aggregate(
  buckets: (Record<string, string> | null | undefined)[],
): ShareDownloadStats {
  const result: ShareDownloadStats = { total: 0, files: {} };
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const [field, value] of Object.entries(bucket)) {
      const count = Number(value);
      if (!Number.isFinite(count) || count === 0) continue;
      if (field === TOTAL_FIELD) result.total += count;
      else result.files[field] = (result.files[field] ?? 0) + count;
    }
  }
  return result;
}

function currentDay() {
  return Math.floor(Date.now() / 86_400_000);
}

function bucketKey(day: number, shareId: string) {
  return `${DOWNLOAD_KEY_PREFIX}${day}:${shareId}`;
}
