import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import {
  sumFileSizes,
  isPublicShare,
  publicShareWhere,
} from "src/share/share.util";
import { findPreview, PreviewKind } from "src/share/preview.util";
import {
  COUNTRY_FIELD_PREFIX,
  isCountryCode,
  normalizeCountryCode,
} from "src/utils/country.util";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const VIEW_KEY_PREFIX = "pingvin:trending:views:";
const META_KEY_PREFIX = "pingvin:trending:meta:";
const RANK_KEY_PREFIX = "pingvin:trending:rank:";
const GEO_KEY_PREFIX = "pingvin:trending:geo:hour:";
const SEED_KEY_PREFIX = "pingvin:trending:seed:";
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const VIEW_TTL_SECONDS = (WINDOW_DAYS + 1) * 24 * 60 * 60;
const META_TTL_SECONDS = (WINDOW_DAYS + 1) * 24 * 60 * 60;
const MAX_SHARE_AGE_MS = WINDOW_DAYS * DAY_MS;
const MAX_DESCRIPTION_LENGTH = 240;
const CANDIDATE_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 100;
const RESULT_CACHE_MS = 30 * 1000;
// The recent list scans a bounded number of the newest public shares so the
// text-only/protected rows do not turn into an unbounded query.
const RECENT_SCAN_LIMIT = 1000;
const RECENT_MAX_RESULT = 200;
const RECENT_CACHE_MS = 30 * 1000;
// Shares viewed before the cache window expanded have no retained daily score.
// They are seeded once from SQLite; retries are throttled if the database is
// unavailable during the first read.
const SEED_RETRY_MS = 5 * 60 * 1000;
// The country ranking is read from hourly hashes. Twenty-four HGETALL replies
// are aggregated in one round trip and the result is reused for five minutes,
// matching the edge TTL on the API response.
const GEO_WINDOW_HOURS = 24;
const GEO_TTL_SECONDS = (GEO_WINDOW_HOURS + 1) * 60 * 60;
const GEO_COUNTRY_LIMIT = 10;
const GEO_SHARE_LIMIT = 10;
// Deleted/expired shares can leave high-scoring entries without metadata.
// Inspect extra candidates before trimming, so a country panel still fills up
// after churn. Only the normal metadata keys are read; nothing extra is stored.
const GEO_COUNTRY_CANDIDATES = GEO_COUNTRY_LIMIT * 2;
const GEO_SHARE_CANDIDATES = GEO_SHARE_LIMIT * 3;
const GEO_CACHE_MS = 5 * 60 * 1000;
// Cached metadata from before preview selection preferred a playable video or
// carried the share's update time is refreshed once. The field is internal to
// the cache payload.
const PREVIEW_VERSION = 2;

export type TrendingShare = {
  id: string;
  name?: string;
  description?: string;
  views: number;
  previewFileId: string;
  previewKind: PreviewKind;
  fileCount?: number;
  size?: number;
  createdAt: string;
  updatedAt?: string;
  // Set by the recent listing so the card can show a play icon even when the
  // chosen thumbnail is an image.
  hasVideo?: boolean;
};

export type TrendingCountry = {
  country: string;
  views: number;
  shares: TrendingShare[];
};

// Views come from the sorted-set score; everything else is a small immutable
// card payload. Reusing one key per share keeps the Valkey footprint bounded.
type TrendingMeta = Omit<TrendingShare, "views"> & {
  previewVersion?: number;
};

type TrendingSource = {
  id: string;
  name?: string | null;
  description?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
  views: number;
  files?: { id: string; name: string; size: string | number }[];
};

/**
 * Ranks public shares from the last thirty days by their total view count.
 * Both the counters and the ranking are kept in Valkey. SQLite is only read
 * once to backfill metadata written before a field was added.
 */
@Injectable()
export class TrendingService {
  private cached?: { at: number; items: TrendingShare[] };
  private countriesCached?: { at: number; value: TrendingCountry[] };
  private recentCached?: { at: number; items: TrendingShare[] };
  private pendingRanking?: Promise<TrendingShare[] | undefined>;
  private pendingCountries?: Promise<TrendingCountry[] | undefined>;
  private seedCheckedAt = 0;

  constructor(
    private readonly valkey: ValkeyService,
    private readonly prisma: PrismaService,
  ) {}

  async recordView(share: TrendingSource, country?: string): Promise<void> {
    const code = normalizeCountryCode(country);
    const recent =
      Date.now() - new Date(share.createdAt).getTime() <= MAX_SHARE_AGE_MS;
    const media = recent ? findPreview(share.files) : undefined;
    const preview = media?.preview;
    // A country-only view still updates the country total even when the share
    // has no preview or has left the thirty-day window. The per-share ranking
    // remains limited to shares that can actually be rendered.
    if (!preview && !code) return;

    const meta: TrendingMeta | undefined = preview
      ? buildMeta(share, preview, media?.hasVideo === true)
      : undefined;

    // Keep the short result cache: a view only changes a score, and rebuilding
    // the ranking after every view would turn each visit into extra Valkey
    // reads. The cached order is at most 30 seconds old.
    await this.valkey.run(async (client) => {
      const multi = client.multi();
      if (meta) {
        const viewKey = viewKeyFor(currentDay());
        const metaKey = metaKeyFor(share.id);
        multi.zAdd(viewKey, { score: share.views, value: share.id });
        multi.expire(viewKey, VIEW_TTL_SECONDS);
        // One metadata entry per share instead of one copy in every day
        // bucket. The card payload is immutable until the share is edited
        // (which deletes the key), so NX avoids rewriting it on every view.
        // The thirty-one-day TTL still covers the thirty-day ranking window.
        multi.set(metaKey, JSON.stringify(meta), {
          EX: META_TTL_SECONDS,
          NX: true,
        });
      }
      if (code) {
        // Country totals cover every public share view; the per-share fields
        // keep the top ten list aligned with the renderable trending shares.
        // One hourly hash keeps the footprint to 25 short-lived keys.
        const geoKey = geoKeyFor(currentHour());
        multi.hIncrBy(geoKey, geoTotalFieldFor(code), 1);
        if (meta) multi.hIncrBy(geoKey, geoFieldFor(code, share.id), 1);
        multi.expire(geoKey, GEO_TTL_SECONDS);
      }
      await multi.exec();
    });
  }

  async getTrending(limit = DEFAULT_RESULT_LIMIT): Promise<TrendingShare[]> {
    const requested =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : DEFAULT_RESULT_LIMIT;
    const resultLimit = Math.min(requested, MAX_RESULT_LIMIT);

    if (this.cached && Date.now() - this.cached.at < RESULT_CACHE_MS)
      return this.cached.items.slice(0, resultLimit);

    // Coalesce a cold-cache burst into one Valkey read. The 30-second result
    // cache normally makes this a non-issue, but a restart or expiry can
    // otherwise produce one union per concurrent request.
    const pendingItems = await (this.pendingRanking ?? this.startRankingRead());
    if (!pendingItems) return [];
    return pendingItems.slice(0, resultLimit);
  }

  private startRankingRead(): Promise<TrendingShare[] | undefined> {
    const read = this.valkey
      .run((client) => this.read(client))
      .then((items) => {
        if (items) this.cached = { at: Date.now(), items };
        return items;
      });
    this.pendingRanking = read;
    void read
      .finally(() => {
        if (this.pendingRanking === read) this.pendingRanking = undefined;
      })
      .catch(() => {});
    return read;
  }

  /**
   * Returns the ten countries with the most public share views in the last
   * 24 hours and, for each country, its ten most-viewed shares. A share may
   * appear in more than one country. Everything is derived from the hourly
   * Valkey hashes written by recordView; SQLite is only touched by the existing
   * legacy-metadata backfill.
   */
  async getTrendingCountries(): Promise<TrendingCountry[]> {
    if (
      this.countriesCached &&
      Date.now() - this.countriesCached.at < GEO_CACHE_MS
    )
      return this.countriesCached.value;

    const value = await (this.pendingCountries ?? this.startCountriesRead());
    return value ?? [];
  }

  private startCountriesRead(): Promise<TrendingCountry[] | undefined> {
    const read = this.valkey
      .run((client) => this.readCountries(client))
      .then((value) => {
        if (value) this.countriesCached = { at: Date.now(), value };
        return value;
      });
    this.pendingCountries = read;
    void read
      .finally(() => {
        if (this.pendingCountries === read) this.pendingCountries = undefined;
      })
      .catch(() => {});
    return read;
  }

  /**
   * Newest public shares that can render a thumbnail. The query is ordered by
   * upload time and limited to the newest window; the exact visibility and
   * media checks reuse the same helpers as the ranking. The result is cached
   * for 30 seconds and served with a short edge TTL, so the page costs at most
   * one indexed SQLite read per cache window.
   */
  async getRecent(limit = RECENT_MAX_RESULT): Promise<TrendingShare[]> {
    const requested =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : RECENT_MAX_RESULT;
    const resultLimit = Math.min(requested, RECENT_MAX_RESULT);

    if (
      this.recentCached &&
      Date.now() - this.recentCached.at < RECENT_CACHE_MS
    )
      return this.recentCached.items.slice(0, resultLimit);

    const shares = await this.prisma.share
      .findMany({
        where: publicShareWhere(),
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          views: true,
          security: {
            select: {
              password: true,
              maxViews: true,
              restrictToRecipients: true,
            },
          },
          reverseShare: { select: { publicAccess: true } },
          files: {
            select: { id: true, name: true, size: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: RECENT_SCAN_LIMIT,
      })
      .catch(() => undefined);
    if (!shares) return [];

    const items: TrendingShare[] = [];
    for (const share of shares) {
      if (!isPublicShare(share)) continue;
      const media = findPreview(share.files);
      if (!media) continue;

      items.push(
        toTrendingShare(
          buildMeta(share, media.preview, media.hasVideo),
          share.views,
        ),
      );
      if (items.length >= RECENT_MAX_RESULT) break;
    }

    this.recentCached = { at: Date.now(), items };
    return items.slice(0, resultLimit);
  }

  /**
   * Removes a share from the ranking when it is edited, expires or is deleted.
   * Score buckets are short-lived, so only the share metadata has to be purged.
   */
  async invalidate(shareIds: string | string[]): Promise<void> {
    const ids = Array.isArray(shareIds) ? shareIds : [shareIds];
    if (ids.length === 0) return;
    this.cached = undefined;
    this.countriesCached = undefined;
    this.recentCached = undefined;

    await this.valkey.run(async (client) => {
      const multi = client.multi();
      for (const id of ids) multi.del(metaKeyFor(id));
      await multi.exec();
    });
  }

  /**
   * Fills the current day's sorted set from SQLite once per window version.
   * View buckets written before the ranking window grew have already expired,
   * so without this seed a share created inside the window but not viewed for
   * more than a week would be missing. The marker key contains the window size,
   * so changing WINDOW_DAYS seeds again. Normal reads stay cache-only.
   */
  private async ensureSeed(client: ValkeyClient): Promise<void> {
    if (Date.now() - this.seedCheckedAt < SEED_RETRY_MS) return;
    this.seedCheckedAt = Date.now();
    if (await client.exists(seedKey())) return;
    await this.seed(client);
  }

  private async seed(client: ValkeyClient): Promise<void> {
    const shares = await this.prisma.share
      .findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - MAX_SHARE_AGE_MS) },
          uploadLocked: true,
          removedReason: null,
          views: { gt: 0 },
        },
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          views: true,
          expiration: true,
          security: {
            select: {
              password: true,
              maxViews: true,
              restrictToRecipients: true,
            },
          },
          reverseShare: { select: { publicAccess: true } },
          files: {
            select: { id: true, name: true, size: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { views: "desc" },
      })
      .catch(() => undefined);
    if (!shares) return;

    const now = Date.now();
    const viewKey = viewKeyFor(currentDay());
    const multi = client.multi();
    let ranked = 0;

    for (const share of shares) {
      if (share.views <= 0) continue;
      if (now - share.createdAt.getTime() > MAX_SHARE_AGE_MS) continue;
      if (!isPublicShare(share)) continue;
      if (share.expiration.getTime() !== 0 && share.expiration.getTime() <= now)
        continue;

      const media = findPreview(share.files);
      if (!media) continue;

      multi.zAdd(viewKey, { score: share.views, value: share.id });
      multi.set(
        metaKeyFor(share.id),
        JSON.stringify(buildMeta(share, media.preview, media.hasVideo)),
        {
          EX: META_TTL_SECONDS,
          NX: true,
        },
      );
      ranked += 1;
    }

    if (ranked > 0) multi.expire(viewKey, VIEW_TTL_SECONDS);
    // The marker is written in the same MULTI, so a failed connection retries
    // instead of leaving an empty ranking marked as seeded.
    multi.set(seedKey(), "1");
    await multi.exec().catch(() => {});
  }

  private async read(client: ValkeyClient): Promise<TrendingShare[]> {
    await this.ensureSeed(client);

    const day = currentDay();
    const keys = Array.from({ length: WINDOW_DAYS }, (_, offset) =>
      viewKeyFor(day - offset),
    );
    // A unique temporary key keeps concurrent ranking reads from deleting each
    // other's union. The short TTL covers a process that dies between the
    // union and the DEL; the normal path removes it immediately.
    const rankKey = `${RANK_KEY_PREFIX}${process.pid}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2)}`;
    const multi = client.multi();
    multi.zUnionStore(rankKey, keys, { AGGREGATE: "MAX" });
    multi.zRangeWithScores(rankKey, 0, CANDIDATE_LIMIT - 1, { REV: true });
    multi.expire(rankKey, 60);
    multi.del(rankKey);
    const replies = await multi.exec();
    const ranked = replies?.[1] as unknown as
      | {
          value: string;
          score: number;
        }[]
      | null;
    if (!ranked?.length) return [];

    const ids = ranked.map((item) => item.value);
    // One MGET for every candidate replaces thirty per-day HGETs.
    const values = await client.mGet(ids.map(metaKeyFor));
    const metas = parseMetaValues(values);

    // A deploy that adds metadata fields leaves active shares with the old
    // shape until they are viewed again. Fill those entries from SQLite once
    // and write the enriched copy back, so the normal path stays cache-only.
    const legacyIds = legacyMetaIds(ids, metas);
    if (legacyIds.length > 0) await this.backfill(client, legacyIds, metas);

    const now = Date.now();
    const items: TrendingShare[] = [];
    for (const { value: id, score } of ranked) {
      const meta = metas.get(id);
      if (!meta) continue;
      if (now - new Date(meta.createdAt).getTime() > MAX_SHARE_AGE_MS) continue;

      // The union keeps the highest daily score, which is the share's
      // current total view count.
      items.push(toTrendingShare(meta, Number(score)));
    }

    // zRangeWithScores already returned the candidates by descending score.
    return items.slice(0, MAX_RESULT_LIMIT);
  }

  private async readCountries(
    client: ValkeyClient,
  ): Promise<TrendingCountry[]> {
    const hour = currentHour();
    const multi = client.multi();
    for (let offset = 0; offset < GEO_WINDOW_HOURS; offset++)
      multi.hGetAll(geoKeyFor(hour - offset));

    const buckets = (await multi.exec()) as unknown as (Record<
      string,
      string
    > | null)[];
    const views = new Map<string, number>();
    const shares = new Map<string, Map<string, number>>();

    for (const bucket of buckets ?? []) {
      if (!bucket) continue;
      for (const [field, value] of Object.entries(bucket)) {
        const count = Number(value);
        if (!Number.isFinite(count) || count <= 0) continue;

        if (field.startsWith(COUNTRY_FIELD_PREFIX)) {
          const country = field.slice(COUNTRY_FIELD_PREFIX.length);
          if (!isCountryCode(country)) continue;
          views.set(country, (views.get(country) ?? 0) + count);
          continue;
        }

        const separator = field.indexOf(":");
        if (separator !== 2) continue;
        const country = field.slice(0, separator);
        const shareId = field.slice(separator + 1);
        if (!isCountryCode(country) || !shareId) continue;

        let countryShares = shares.get(country);
        if (!countryShares) {
          countryShares = new Map();
          shares.set(country, countryShares);
        }
        countryShares.set(shareId, (countryShares.get(shareId) ?? 0) + count);
      }
    }

    // Select the ten highest-view countries that have at least one listed
    // share. A share may appear under multiple countries; each country's list
    // reflects that country's own view counts.
    const rankedCountries: {
      country: string;
      views: number;
      shares: { id: string; views: number }[];
    }[] = [];
    for (const [country, countryViews] of [...views.entries()].sort(
      ([aCode, aViews], [bCode, bViews]) =>
        bViews - aViews || aCode.localeCompare(bCode),
    )) {
      const candidates = [
        ...(shares.get(country) ?? new Map<string, number>()).entries(),
      ]
        .sort(
          ([aId, aViews], [bId, bViews]) =>
            bViews - aViews || aId.localeCompare(bId),
        )
        .slice(0, GEO_SHARE_CANDIDATES)
        .map(([id, count]) => ({ id, views: count }));
      if (candidates.length === 0) continue;

      rankedCountries.push({
        country,
        views: countryViews,
        shares: candidates,
      });
      if (rankedCountries.length >= GEO_COUNTRY_CANDIDATES) break;
    }
    if (rankedCountries.length === 0) return [];

    const ids = new Set(
      rankedCountries.flatMap((country) =>
        country.shares.map((share) => share.id),
      ),
    );
    const metas = parseMetaValues(await client.mGet([...ids].map(metaKeyFor)));
    const legacyIds = legacyMetaIds([...ids], metas);
    if (legacyIds.length > 0) await this.backfill(client, legacyIds, metas);

    const now = Date.now();
    return rankedCountries
      .map(({ country, views: countryViews, shares: candidates }) => ({
        country,
        views: countryViews,
        shares: candidates
          .flatMap(({ id, views: shareViews }) => {
            const meta = metas.get(id);
            if (!meta) return [];
            if (now - new Date(meta.createdAt).getTime() > MAX_SHARE_AGE_MS)
              return [];
            return [toTrendingShare(meta, shareViews)];
          })
          .slice(0, GEO_SHARE_LIMIT),
      }))
      .filter((country) => country.shares.length > 0)
      .slice(0, GEO_COUNTRY_LIMIT);
  }

  private async backfill(
    client: ValkeyClient,
    ids: string[],
    metas: Map<string, TrendingMeta>,
  ): Promise<void> {
    const shares = await this.prisma.share
      .findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          uploadLocked: true,
          removedReason: true,
          files: {
            select: { id: true, name: true, size: true },
            orderBy: { name: "asc" },
          },
        },
      })
      .catch(() => undefined);
    if (!shares) return;

    const multi = client.multi();
    const found = new Set<string>();
    let writes = 0;
    const now = Date.now();

    const remove = (id: string) => {
      metas.delete(id);
      multi.del(metaKeyFor(id));
      writes += 1;
    };

    for (const share of shares) {
      found.add(share.id);
      const media =
        share.uploadLocked && !share.removedReason
          ? findPreview(share.files)
          : undefined;
      if (!media || now - share.createdAt.getTime() > MAX_SHARE_AGE_MS) {
        remove(share.id);
        continue;
      }

      const meta: TrendingMeta = buildMeta(
        share,
        media.preview,
        media.hasVideo,
      );
      metas.set(share.id, meta);
      multi.set(metaKeyFor(share.id), JSON.stringify(meta), {
        EX: META_TTL_SECONDS,
      });
      writes += 1;
    }

    // Deleted shares may leave a ranking score behind until the daily buckets
    // expire; drop their metadata while the IDs are already known.
    for (const id of ids) if (!found.has(id)) remove(id);

    if (writes === 0) return;
    try {
      await multi.exec();
    } catch {
      // Keep serving the enriched response even if the cache write fails.
    }
  }
}

function buildMeta(
  share: {
    id: string;
    name?: string | null;
    description?: string | null;
    createdAt: Date | string;
    updatedAt?: Date | string | null;
    files?: { id: string; name: string; size: string | number }[];
  },
  preview: { id: string; kind: PreviewKind },
  hasVideo: boolean,
): TrendingMeta {
  return {
    id: share.id,
    name: share.name || undefined,
    description: normalizeDescription(share.description),
    previewFileId: preview.id,
    previewKind: preview.kind,
    hasVideo,
    fileCount: share.files?.length ?? 0,
    size: sumFileSizes(share.files),
    createdAt: new Date(share.createdAt).toISOString(),
    updatedAt: new Date(share.updatedAt ?? share.createdAt).toISOString(),
    previewVersion: PREVIEW_VERSION,
  };
}

function normalizeDescription(description?: string | null) {
  const normalized = description?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
}

function toTrendingShare(meta: TrendingMeta, views: number): TrendingShare {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    views,
    previewFileId: meta.previewFileId,
    previewKind: meta.previewKind,
    // Older cache entries predate these fields; the next view rewrites them.
    // Keeping zero here lets the card hide the row until then.
    fileCount: Number(meta.fileCount) || 0,
    size: Number(meta.size) || 0,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    hasVideo: meta.hasVideo === true,
  };
}

function parseMetaValues(values: (string | null)[] | null | undefined) {
  const metas = new Map<string, TrendingMeta>();
  for (const value of values ?? []) {
    if (!value) continue;
    try {
      const meta = JSON.parse(value) as TrendingMeta;
      if (!meta?.id) continue;
      metas.set(meta.id, meta);
    } catch {
      // Ignore malformed cache entries; their keys expire on their own.
    }
  }
  return metas;
}

// A deploy that adds metadata fields leaves active shares with the old shape
// until they are viewed again. These IDs are refreshed once from SQLite.
function legacyMetaIds(ids: string[], metas: Map<string, TrendingMeta>) {
  return ids.filter((id) => {
    const meta = metas.get(id);
    return (
      !!meta &&
      (meta.fileCount === undefined ||
        meta.size === undefined ||
        meta.updatedAt === undefined ||
        meta.hasVideo === undefined ||
        meta.previewVersion !== PREVIEW_VERSION)
    );
  });
}

function currentDay() {
  return Math.floor(Date.now() / DAY_MS);
}

function currentHour() {
  return Math.floor(Date.now() / HOUR_MS);
}

function viewKeyFor(day: number) {
  return `${VIEW_KEY_PREFIX}${day}`;
}

function geoKeyFor(hour: number) {
  return `${GEO_KEY_PREFIX}${hour}`;
}

function geoFieldFor(country: string, shareId: string) {
  return `${country}:${shareId}`;
}

function geoTotalFieldFor(country: string) {
  return `${COUNTRY_FIELD_PREFIX}${country}`;
}

function metaKeyFor(shareId: string) {
  return `${META_KEY_PREFIX}${shareId}`;
}

function seedKey() {
  return `${SEED_KEY_PREFIX}${WINDOW_DAYS}`;
}
