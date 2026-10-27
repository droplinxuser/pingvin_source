import type { Cache } from "cache-manager";

const NO_STORE = "no-store";
// Browser caches may keep a public file for an hour. Shared caches get a much
// shorter TTL (and no `immutable`) so an owner/admin deletion or takedown stops
// being served from Cloudflare within minutes instead of a full day.
const PUBLIC_CACHE_MAX_AGE = 60 * 60;
const PUBLIC_EDGE_MAX_AGE = 10 * 60;

export const SHARE_DATA_CACHE_TTL_MS = 30 * 1000;

export const shareDataCacheKey = (shareId: string) => `share:data:${shareId}`;
export const shareGuardCacheKey = (shareId: string) => `share:guard:${shareId}`;
export const shareSeoCacheKey = (shareId: string) => `share:seo:${shareId}`;

/**
 * A cache fill can start before an edit and finish after the invalidation.
 * This counter is bumped on every invalidation so such a late write is either
 * skipped or immediately removed, instead of restoring a pre-edit (possibly
 * unprotected) share object for the next TTL window.
 */
const shareCacheEpochs = new Map<string, number>();

export function getShareCacheEpoch(shareId: string): number {
  return shareCacheEpochs.get(shareId) ?? 0;
}

function bumpShareCacheEpoch(shareId: string) {
  if (shareCacheEpochs.size > 50_000) shareCacheEpochs.clear();
  shareCacheEpochs.set(shareId, getShareCacheEpoch(shareId) + 1);
}

export async function setCachedValueIfCurrent(
  cache: Cache,
  key: string,
  value: unknown,
  ttl: number,
  shareId: string,
  epoch: number,
): Promise<void> {
  if (getShareCacheEpoch(shareId) !== epoch) return;
  await setCachedValue(cache, key, value, ttl);
  // A write can overlap the invalidation; remove it if the generation moved.
  if (getShareCacheEpoch(shareId) !== epoch)
    await deleteCachedValue(cache, key);
}

const cacheHeaders = (value: string) => ({
  "Cache-Control": value,
  "CDN-Cache-Control": value,
  "Cloudflare-CDN-Cache-Control": value,
});

export const NO_STORE_HEADERS = cacheHeaders(NO_STORE);

/**
 * Cache headers for API responses that are safe to store on the CDN but should
 * be revalidated by browsers (config, public counters).
 */
export function getEdgeCacheHeaders(maxAge: number) {
  return cacheHeaders(
    `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`,
  );
}

/**
 * A ZIP archive is rebuilt whenever the owner changes a share's files, so it
 * gets a short edge TTL instead of the immutable headers used for single
 * files. Protected shares are never stored by the CDN.
 */
export function getZipCacheHeaders(
  isPublicShare: boolean,
): Record<string, string> {
  return isPublicShare ? getEdgeCacheHeaders(60) : NO_STORE_HEADERS;
}

/**
 * Cache headers for a successful file response. Public-share files get a short
 * shared-cache TTL so removals propagate quickly; protected shares stay
 * private so CDN edges never serve them to other visitors.
 */
export function getDownloadCacheHeaders(
  isPublicShare: boolean,
  etag?: string,
): Record<string, string> {
  const headers: Record<string, string> = isPublicShare
    ? cacheHeaders(
        `public, max-age=${PUBLIC_CACHE_MAX_AGE}, s-maxage=${PUBLIC_EDGE_MAX_AGE}, stale-while-revalidate=60`,
      )
    : cacheHeaders("private");
  if (isPublicShare && etag) headers.ETag = etag;
  return headers;
}

/**
 * Public files and previews are served as streams, so Express never applies
 * its built-in freshness check. Comparing If-None-Match here lets a browser or
 * the CDN revalidate an expired copy with a 304 instead of downloading the
 * whole file again.
 */
export function isNotModified(
  request: { headers: Record<string, string | string[] | undefined> },
  etag?: string,
): boolean {
  if (!etag) return false;
  const header = request.headers["if-none-match"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;

  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag);
}

export async function getCachedValue<T>(
  cache: Cache,
  key: string,
): Promise<T | undefined> {
  try {
    return await cache.get<T>(key);
  } catch {
    // Caching is optional; fall back to the database/files when Valkey is down.
    return undefined;
  }
}

export async function setCachedValue(
  cache: Cache,
  key: string,
  value: unknown,
  ttl: number,
): Promise<void> {
  try {
    await cache.set(key, value, ttl);
  } catch {
    // Caching is optional; keep the request working without Valkey.
  }
}

async function deleteCachedValue(cache: Cache, key: string): Promise<void> {
  try {
    await cache.del(key);
  } catch {
    // Caching is optional; a stale entry expires on its own.
  }
}

/**
 * Drops only the visitor-facing share payload. Comment changes need this but
 * leave the security/SEO entries valid, so their next read stays free.
 */
export async function invalidateShareData(
  cache: Cache,
  shareId: string,
): Promise<void> {
  bumpShareCacheEpoch(shareId);
  await deleteCachedValue(cache, shareDataCacheKey(shareId));
}

export async function invalidateShareDataCache(
  cache: Cache,
  shareId: string,
): Promise<void> {
  await Promise.all([
    invalidateShareData(cache, shareId),
    deleteCachedValue(cache, shareGuardCacheKey(shareId)),
    deleteCachedValue(cache, shareSeoCacheKey(shareId)),
  ]);
}
