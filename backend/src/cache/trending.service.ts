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
import { recentDownloadHourKeys } from "./download.service";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const META_KEY_PREFIX = "pingvin:trending:meta:";
const RANK_KEY_PREFIX = "pingvin:trending:rank:";
const GEO_KEY_PREFIX = "pingvin:trending:geo:hour:";
const WINDOW_DAYS = 30;
// Views and country shares both use the same 24 hourly geo hashes. The 30-day
// window below still controls which shares may appear at all.
const HOUR_WINDOW = 24;
const UNKNOWN_COUNTRY = "XX";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const META_TTL_SECONDS = (WINDOW_DAYS + 1) * 24 * 60 * 60;
const MAX_SHARE_AGE_MS = WINDOW_DAYS * DAY_MS;
const MAX_DESCRIPTION_LENGTH = 240;
const CANDIDATE_LIMIT = 400;
const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 200;
const RESULT_CACHE_MS = 60 * 1000;
// The recent list scans a bounded number of the newest public shares so the
// text-only/protected rows do not turn into an unbounded query.
const RECENT_SCAN_LIMIT = 1000;
const RECENT_MAX_RESULT = 200;
const RECENT_CACHE_MS = 30 * 1000;
// File-only cards list a couple of names over the thumbnail area.
const MAX_CARD_FILE_NAMES = 3;
// The country ranking is read from hourly hashes. Twenty-four HGETALL replies
// are aggregated in one round trip and the result is reused for five minutes,
// matching the edge TTL on the API response.
const GEO_TTL_SECONDS = (HOUR_WINDOW + 1) * 60 * 60;
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
  // Media listings (trending, new-media) always set these. File-only listings
  // (new-files) and search results may omit them and render a file icon.
  previewFileId?: string;
  previewKind?: PreviewKind;
  fileCount?: number;
  // A few file names for the file-only ("new files") cards, which show a list
  // instead of a thumbnail.
  fileNames?: string[];
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

// The home "/new-media" and "/new-files" listings are derived from one
// newest-shares scan: the media cards keep shares with an image/video preview
// and the file-only cards keep the rest. This lets both listings share a single
// SQLite read instead of scanning the same rows twice per cache window.
type RecentScan = {
  at: number;
  media: TrendingShare[];
  files: TrendingShare[];
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
  private recentScanCached?: RecentScan;
  private pendingRanking?: Promise<TrendingShare[] | undefined>;
  private pendingCountries?: Promise<TrendingCountry[] | undefined>;
  private pendingRecentScan?: Promise<RecentScan>;

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
    // reads. The cached order is at most 60 seconds old.
    await this.valkey.run(async (client) => {
      const multi = client.multi();
      if (meta) {
        // One metadata entry per share instead of one copy in every hour
        // bucket. The card payload is immutable until the share is edited
        // (which deletes the key), so NX avoids rewriting it on every view.
        // The thirty-one-day TTL still covers the thirty-day ranking window.
        multi.set(metaKeyFor(share.id), JSON.stringify(meta), {
          EX: META_TTL_SECONDS,
          NX: true,
        });
      }
      if (meta || code) {
        // One hourly hash carries both the country totals and the per-share
        // counts used by the main ranking. A view without a country still
        // counts under XX, which the country panel ignores.
        const geoKey = geoKeyFor(currentHour());
        if (code) multi.hIncrBy(geoKey, geoTotalFieldFor(code), 1);
        if (meta)
          multi.hIncrBy(
            geoKey,
            geoFieldFor(code ?? UNKNOWN_COUNTRY, share.id),
            1,
          );
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
    return this.getRecentList(false, limit);
  }

  /**
   * Newest public shares that contain no image or video preview. The UI and
   * cache policy match `getRecent`; only the media predicate is inverted, and
   * both share the same scan.
   */
  async getRecentFiles(limit = RECENT_MAX_RESULT): Promise<TrendingShare[]> {
    return this.getRecentList(true, limit);
  }

  private async getRecentList(
    filesOnly: boolean,
    limit: number,
  ): Promise<TrendingShare[]> {
    const requested =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : RECENT_MAX_RESULT;
    const resultLimit = Math.min(requested, RECENT_MAX_RESULT);

    const scan = await this.getRecentScan();
    const items = filesOnly ? scan.files : scan.media;
    return items.slice(0, resultLimit);
  }

  /**
   * The home page, /new-media, /new-files and client navigations can miss the
   * same 30-second window together. One scan fill serves all of them.
   */
  private async getRecentScan(): Promise<RecentScan> {
    if (
      this.recentScanCached &&
      Date.now() - this.recentScanCached.at < RECENT_CACHE_MS
    )
      return this.recentScanCached;

    if (!this.pendingRecentScan)
      this.pendingRecentScan = this.loadRecentScan().finally(() => {
        this.pendingRecentScan = undefined;
      });
    return this.pendingRecentScan;
  }

  private async loadRecentScan(): Promise<RecentScan> {
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
    // A failed read must not be cached: `at: 0` makes the next request retry.
    if (!shares) return { at: 0, media: [], files: [] };

    const media: TrendingShare[] = [];
    const files: TrendingShare[] = [];
    for (const share of shares) {
      if (!isPublicShare(share)) continue;
      const preview = findPreview(share.files);
      if (preview) {
        if (media.length < RECENT_MAX_RESULT)
          media.push(
            toTrendingShare(
              buildMeta(share, preview.preview, preview.hasVideo),
              share.views,
            ),
          );
      } else if (files.length < RECENT_MAX_RESULT) {
        files.push(buildFileCard(share));
      }

      if (
        media.length >= RECENT_MAX_RESULT &&
        files.length >= RECENT_MAX_RESULT
      )
        break;
    }

    const scan: RecentScan = { at: Date.now(), media, files };
    this.recentScanCached = scan;
    return scan;
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
    this.recentScanCached = undefined;

    await this.valkey.run(async (client) => {
      const multi = client.multi();
      for (const id of ids) multi.del(metaKeyFor(id));
      await multi.exec();
    });
  }

  private async read(client: ValkeyClient): Promise<TrendingShare[]> {
    const hour = currentHour();
    // A unique temporary key keeps concurrent ranking reads from deleting each
    // other's download union. The short TTL covers a process that dies between
    // the union and the DEL; the normal path removes it immediately.
    const suffix = `${process.pid}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2)}`;
    const downloadRankKey = `${RANK_KEY_PREFIX}downloads:${suffix}`;
    const multi = client.multi();
    // The main ranking and the country panel share the same hourly hashes.
    for (let offset = 0; offset < HOUR_WINDOW; offset++)
      multi.hGetAll(geoKeyFor(hour - offset));
    multi.zUnionStore(downloadRankKey, recentDownloadHourKeys(), {
      AGGREGATE: "SUM",
    });
    multi.zRangeWithScores(downloadRankKey, 0, -1);
    multi.del(downloadRankKey);
    const replies = await multi.exec();

    const buckets = (replies?.slice(0, HOUR_WINDOW) ??
      []) as unknown as (Record<string, string> | null)[];
    const views = new Map<string, number>();
    for (const bucket of buckets) {
      if (!bucket) continue;
      for (const [field, value] of Object.entries(bucket)) {
        if (field.startsWith(COUNTRY_FIELD_PREFIX)) continue;
        // Per-share fields are `<two-letter country>:<shareId>`; XX is the
        // fallback for a view without a country and is ignored by the panel.
        const separator = field.indexOf(":");
        if (separator !== 2) continue;
        if (!/^[A-Z]{2}$/.test(field.slice(0, 2))) continue;
        const id = field.slice(3);
        const count = Number(value);
        if (!id || !Number.isFinite(count) || count <= 0) continue;
        views.set(id, (views.get(id) ?? 0) + count);
      }
    }

    const ranked = [...views.entries()]
      .map(([value, score]) => ({ value, score }))
      .sort((a, b) => b.score - a.score || b.value.localeCompare(a.value))
      .slice(0, CANDIDATE_LIMIT);
    if (ranked.length === 0) return [];

    const downloadRanked = replies?.[HOUR_WINDOW + 1] as unknown as
      | {
          value: string;
          score: number;
        }[]
      | null;
    const downloads = new Map(
      (downloadRanked ?? []).map((item) => [item.value, Number(item.score)]),
    );

    const ids = ranked.map((item) => item.value);
    // One MGET for every candidate replaces 24 per-hour HGETs of metadata.
    const values = await client.mGet(ids.map(metaKeyFor));
    const metas = parseMetaValues(values);

    // A deploy that adds metadata fields leaves active shares with the old
    // shape until they are viewed again. Fill those entries from SQLite once
    // and write the enriched copy back, so the normal path stays cache-only.
    const legacyIds = legacyMetaIds(ids, metas);
    if (legacyIds.length > 0) await this.backfill(client, legacyIds, metas);

    const now = Date.now();
    const items: { item: TrendingShare; downloads: number }[] = [];
    for (const { value: id, score } of ranked) {
      const meta = metas.get(id);
      if (!meta) continue;
      if (now - new Date(meta.createdAt).getTime() > MAX_SHARE_AGE_MS) continue;

      items.push({
        item: toTrendingShare(meta, Number(score)),
        downloads: downloads.get(id) ?? 0,
      });
    }

    // Primary: 24-hour views. Secondary: 24-hour downloads. The stable sort
    // keeps the id order for exact ties.
    items.sort(
      (a, b) => b.item.views - a.item.views || b.downloads - a.downloads,
    );
    return items.slice(0, MAX_RESULT_LIMIT).map(({ item }) => item);
  }

  private async readCountries(
    client: ValkeyClient,
  ): Promise<TrendingCountry[]> {
    const hour = currentHour();
    const multi = client.multi();
    for (let offset = 0; offset < HOUR_WINDOW; offset++)
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

function buildFileCard(share: {
  id: string;
  name?: string | null;
  description?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  views: number;
  files?: { id: string; name: string; size: string | number }[];
}): TrendingShare {
  return {
    id: share.id,
    name: share.name || undefined,
    description: normalizeDescription(share.description),
    views: share.views,
    fileCount: share.files?.length ?? 0,
    fileNames: share.files
      ?.slice(0, MAX_CARD_FILE_NAMES)
      .map((file) => file.name),
    size: sumFileSizes(share.files),
    createdAt: new Date(share.createdAt).toISOString(),
    updatedAt: new Date(share.updatedAt ?? share.createdAt).toISOString(),
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

function currentHour() {
  return Math.floor(Date.now() / HOUR_MS);
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
