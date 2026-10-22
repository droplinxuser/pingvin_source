const NO_STORE = "no-store";
const PUBLIC_CACHE_MAX_AGE = 60 * 60 * 24 * 365;

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
