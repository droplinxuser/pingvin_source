const NO_STORE = "no-store";
const PUBLIC_CACHE_MAX_AGE = 60 * 60 * 24 * 365;

export const NO_STORE_HEADERS = {
  "Cache-Control": NO_STORE,
  "CDN-Cache-Control": NO_STORE,
  "Cloudflare-CDN-Cache-Control": NO_STORE,
};

/**
 * Cache headers for a successful file or ZIP response. Files belonging to a
 * public share can be stored on Cloudflare and in browsers for a year;
 * protected shares stay private so CDN edges never serve them to other
 * visitors.
 */
export function getDownloadCacheHeaders(
  isPublicShare: boolean,
): Record<string, string> {
  const value = isPublicShare
    ? `public, max-age=${PUBLIC_CACHE_MAX_AGE}, immutable`
    : "private";
  return {
    "Cache-Control": value,
    "CDN-Cache-Control": value,
    "Cloudflare-CDN-Cache-Control": value,
  };
}
