import type { Cache } from "cache-manager";

export const SHARE_DATA_CACHE_TTL_MS = 30 * 1000;
export const SHARE_UPLOADER_CACHE_TTL_MS = 5 * 60 * 1000;

export const shareDataCacheKey = (shareId: string) => `share:data:${shareId}`;
export const shareUploaderCacheKey = (shareId: string) =>
  `share:uploader:${shareId}`;

export async function getCachedValue<T>(
  cache: Cache,
  key: string,
): Promise<T | undefined> {
  try {
    return await cache.get<T>(key);
  } catch {
    // Caching is optional; fall back to SQLite/files when Valkey is down.
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

export async function deleteCachedValue(
  cache: Cache,
  key: string,
): Promise<void> {
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

export async function invalidateShareCaches(
  cache: Cache,
  shareId: string,
): Promise<void> {
  await Promise.all([
    invalidateShareDataCache(cache, shareId),
    deleteCachedValue(cache, shareUploaderCacheKey(shareId)),
  ]);
}
