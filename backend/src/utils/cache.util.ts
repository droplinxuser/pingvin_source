import type { Cache } from "cache-manager";

const NO_STORE = "no-store";
const PUBLIC_CACHE_MAX_AGE = 60 * 60 * 24 * 365;

export const SHARE_DATA_CACHE_TTL_MS = 30 * 1000;

export const shareDataCacheKey = (shareId: string) => `share:data:${shareId}`;

const cacheHeaders = (value: string) => ({
  "Cache-Control": value,
  "CDN-Cache-Control": value,
  "Cloudflare-CDN-Cache-Control": value,
});

export const NO_STORE_HEADERS = cacheHeaders(NO_STORE);

export function getPublicCacheHeaders(maxAge: number, immutable = false) {
  return cacheHeaders(
    `public, max-age=${maxAge}${immutable ? ", immutable" : ""}`,
  );
}

/**
 * Cache headers for a successful file or ZIP response. Files belonging to a
 * public share can be stored on Cloudflare and in browsers for a year;
 * protected shares stay private so CDN edges never serve them to other
 * visitors.
 */
export function getDownloadCacheHeaders(
  isPublicShare: boolean,
): Record<string, string> {
  return isPublicShare
    ? getPublicCacheHeaders(PUBLIC_CACHE_MAX_AGE, true)
    : cacheHeaders("private");
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

export async function invalidateShareDataCache(
  cache: Cache,
  shareId: string,
): Promise<void> {
  await deleteCachedValue(cache, shareDataCacheKey(shareId));
}
