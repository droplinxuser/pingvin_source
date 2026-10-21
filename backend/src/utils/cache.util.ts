import { applyDecorators, Header } from "@nestjs/common";

// Public downloads are immutable for a given share/file URL. Cloudflare and
// browsers may keep them for a year; protected shares stay private.
const DOWNLOAD_CACHE_MAX_AGE = 60 * 60 * 24 * 365;

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};

/**
 * Marks a route whose response must never be cached by browsers, origin
 * servers or CDN edges (e.g. Cloudflare).
 */
export const NoStore = () =>
  applyDecorators(
    Header(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    ),
    Header("CDN-Cache-Control", "no-store"),
    Header("Cloudflare-CDN-Cache-Control", "no-store"),
    Header("Pragma", "no-cache"),
    Header("Expires", "0"),
  );

/**
 * Cache headers for a successful file or ZIP response. Files belonging to a
 * public share can be stored on Cloudflare and in browsers for a year,
 * regardless of whether the visitor has a share token. Protected shares stay
 * private so CDN edges never serve them to other visitors.
 */
export function getDownloadCacheHeaders(
  isPublicShare: boolean,
): Record<string, string> {
  if (!isPublicShare) {
    return {
      "Cache-Control": "private",
      "CDN-Cache-Control": "private",
      "Cloudflare-CDN-Cache-Control": "private",
    };
  }
  const value = `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}, immutable`;
  return {
    "Cache-Control": value,
    "CDN-Cache-Control": value,
    "Cloudflare-CDN-Cache-Control": value,
  };
}
