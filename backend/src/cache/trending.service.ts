import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { sumFileSizes } from "src/share/share.util";
import { getFileMimeType } from "src/utils/mime.util";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const VIEW_KEY_PREFIX = "pingvin:trending:views:";
const META_KEY_PREFIX = "pingvin:trending:meta:";
const RANK_KEY = "pingvin:trending:rank";
const GEO_KEY_PREFIX = "pingvin:trending:geo:hour:";
const GEO_TOTAL_PREFIX = "c:";
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const VIEW_TTL_SECONDS = (WINDOW_DAYS + 1) * 24 * 60 * 60;
const META_TTL_SECONDS = (WINDOW_DAYS + 1) * 24 * 60 * 60;
const MAX_SHARE_AGE_MS = WINDOW_DAYS * DAY_MS;
const MAX_DESCRIPTION_LENGTH = 240;
const CANDIDATE_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 48;
const RESULT_CACHE_MS = 30 * 1000;
// The country ranking is read from hourly hashes. Twenty-four HGETALL replies
// are aggregated in one round trip and the result is reused for five minutes,
// matching the edge TTL on the API response.
const GEO_WINDOW_HOURS = 24;
const GEO_TTL_SECONDS = (GEO_WINDOW_HOURS + 1) * 60 * 60;
const GEO_COUNTRY_LIMIT = 5;
const GEO_SHARE_LIMIT = 20;
const GEO_CACHE_MS = 5 * 60 * 1000;

type MediaKind = "image" | "video";

export type TrendingShare = {
  id: string;
  name?: string;
  description?: string;
  views: number;
  previewFileId: string;
  previewKind: MediaKind;
  fileCount?: number;
  size?: number;
  createdAt: string;
};

export type TrendingCountry = {
  country: string;
  views: number;
  shares: TrendingShare[];
};

// Views come from the sorted-set score; everything else is a small immutable
// card payload. Reusing one key per share keeps the Valkey footprint bounded.
type TrendingMeta = Omit<TrendingShare, "views">;

type TrendingSource = {
  id: string;
  name?: string | null;
  description?: string | null;
  createdAt: Date | string;
  views: number;
  files?: { id: string; name: string; size: string | number }[];
};

/**
 * Ranks public shares from the last seven days by their total view count.
 * Both the counters and the ranking are kept in Valkey. SQLite is only read
 * once to backfill metadata written before a field was added.
 */
@Injectable()
export class TrendingService {
  private cached?: { at: number; items: TrendingShare[] };
  private countriesCached?: { at: number; value: TrendingCountry[] };

  constructor(
    private readonly valkey: ValkeyService,
    private readonly prisma: PrismaService,
  ) {}

  async recordView(share: TrendingSource, country?: string): Promise<void> {
    const code = normalizeCountry(country);
    const recent =
      Date.now() - new Date(share.createdAt).getTime() <= MAX_SHARE_AGE_MS;
    const preview = recent ? findPreview(share.files) : undefined;
    // A country-only view still updates the country total even when the share
    // has no preview or has left the seven-day window. The per-share ranking
    // remains limited to shares that can actually be rendered.
    if (!preview && !code) return;

    const meta: TrendingMeta | undefined = preview
      ? {
          id: share.id,
          name: share.name || undefined,
          description: normalizeDescription(share.description),
          previewFileId: preview.id,
          previewKind: preview.kind,
          fileCount: share.files?.length ?? 0,
          size: sumFileSizes(share.files),
          createdAt: new Date(share.createdAt).toISOString(),
        }
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
        // bucket. Rewriting the small card payload on each view keeps older
        // entries current after a deploy adds a field; SET EX also refreshes
        // the TTL, so no separate EXPIRE is needed.
        multi.set(metaKey, JSON.stringify(meta), { EX: META_TTL_SECONDS });
      }
      if (code) {
        // Country totals cover every public share view; the per-share fields
        // keep the top twenty list aligned with the renderable trending
        // shares. One hourly hash keeps the footprint to 25 short-lived keys.
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

    const items = await this.valkey.run((client) => this.read(client));
    if (!items) return [];
    this.cached = { at: Date.now(), items };
    return items.slice(0, resultLimit);
  }

  /**
   * Returns the five countries with the most public share views in the last
   * 24 hours and, for each country, its twenty most-viewed shares. Everything
   * is derived from the hourly Valkey hashes written by recordView; SQLite is
   * only touched by the existing legacy-metadata backfill.
   */
  async getTrendingCountries(): Promise<TrendingCountry[]> {
    if (
      this.countriesCached &&
      Date.now() - this.countriesCached.at < GEO_CACHE_MS
    )
      return this.countriesCached.value;

    const value = await this.valkey.run((client) => this.readCountries(client));
    if (!value) return [];
    this.countriesCached = { at: Date.now(), value };
    return value;
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

    await this.valkey.run(async (client) => {
      const multi = client.multi();
      for (const id of ids) multi.del(metaKeyFor(id));
      await multi.exec();
    });
  }

  private async read(client: ValkeyClient): Promise<TrendingShare[]> {
    const day = currentDay();
    const keys = Array.from({ length: WINDOW_DAYS }, (_, offset) =>
      viewKeyFor(day - offset),
    );
    const multi = client.multi();
    multi.zUnionStore(RANK_KEY, keys, { AGGREGATE: "MAX" });
    multi.zRangeWithScores(RANK_KEY, 0, CANDIDATE_LIMIT - 1, { REV: true });
    multi.del(RANK_KEY);
    const replies = await multi.exec();
    const ranked = replies?.[1] as unknown as
      | {
          value: string;
          score: number;
        }[]
      | null;
    if (!ranked?.length) return [];

    const ids = ranked.map((item) => item.value);
    // One MGET for every candidate replaces seven per-day HGETs.
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

        if (field.startsWith(GEO_TOTAL_PREFIX)) {
          const country = field.slice(GEO_TOTAL_PREFIX.length);
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

    // A share can be visited from several countries. Keep it only in the
    // country with the highest view count for that share, so the five lists
    // never duplicate a card. Ties resolve by country code for a stable order.
    const owners = new Map<string, { country: string; views: number }>();
    for (const [country, countryShares] of shares) {
      for (const [shareId, count] of countryShares) {
        const owner = owners.get(shareId);
        if (
          !owner ||
          count > owner.views ||
          (count === owner.views && country < owner.country)
        )
          owners.set(shareId, { country, views: count });
      }
    }

    // Select the five highest-view countries that still have at least one
    // unique share after deduplication. Countries whose shares all belong to
    // another country are skipped instead of leaving an empty panel.
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
        .filter(([id]) => owners.get(id)?.country === country)
        .sort(
          ([aId, aViews], [bId, bViews]) =>
            bViews - aViews || aId.localeCompare(bId),
        )
        .slice(0, GEO_SHARE_LIMIT)
        .map(([id, count]) => ({ id, views: count }));
      if (candidates.length === 0) continue;

      rankedCountries.push({
        country,
        views: countryViews,
        shares: candidates,
      });
      if (rankedCountries.length >= GEO_COUNTRY_LIMIT) break;
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
        shares: candidates.flatMap(({ id, views: shareViews }) => {
          const meta = metas.get(id);
          if (!meta) return [];
          if (now - new Date(meta.createdAt).getTime() > MAX_SHARE_AGE_MS)
            return [];
          return [toTrendingShare(meta, shareViews)];
        }),
      }))
      .filter((country) => country.shares.length > 0);
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
      const preview =
        share.uploadLocked && !share.removedReason
          ? findPreview(share.files)
          : undefined;
      if (!preview || now - share.createdAt.getTime() > MAX_SHARE_AGE_MS) {
        remove(share.id);
        continue;
      }

      const meta: TrendingMeta = {
        id: share.id,
        name: share.name || undefined,
        description: normalizeDescription(share.description),
        previewFileId: preview.id,
        previewKind: preview.kind,
        fileCount: share.files.length,
        size: sumFileSizes(share.files),
        createdAt: share.createdAt.toISOString(),
      };
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
    return !!meta && (meta.fileCount === undefined || meta.size === undefined);
  });
}

function findPreview(files?: { id: string; name: string }[]) {
  for (const file of files ?? []) {
    const mimeType = getFileMimeType(file.name, false);
    if (mimeType.startsWith("image/"))
      return { id: file.id, kind: "image" as MediaKind };
    if (mimeType.startsWith("video/"))
      return { id: file.id, kind: "video" as MediaKind };
  }
  return undefined;
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
  return `${GEO_TOTAL_PREFIX}${country}`;
}

function metaKeyFor(shareId: string) {
  return `${META_KEY_PREFIX}${shareId}`;
}

function normalizeCountry(country?: string) {
  const code = country?.trim().toUpperCase();
  return isCountryCode(code) ? code : undefined;
}

function isCountryCode(code?: string): code is string {
  return !!code && /^[A-Z]{2}$/.test(code) && code !== "XX";
}
