import { applyDecorators, Header } from "@nestjs/common";
import { Request } from "express";

// How long Cloudflare and browsers may cache successful download responses
const DOWNLOAD_CACHE_MAX_AGE = 3600;

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
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
 * Cloudflare's default cache key ignores cookies, so responses for
 * authenticated access must not carry public cache headers - otherwise
 * password protected or recipient restricted files would be served from
 * the edge cache to anyone.
 */
function isAuthenticatedRequest(req: Request, shareId: string): boolean {
  return !!(req.cookies.access_token || req.cookies[`share_${shareId}_token`]);
}

/**
 * Cache headers for a successful (full 200) download response: unauthenticated
 * downloads may be cached on Cloudflare edge servers, authenticated downloads
 * stay out of shared caches.
 */
export function getDownloadCacheHeaders(
  req: Request,
  shareId: string,
): Record<string, string> {
  if (isAuthenticatedRequest(req, shareId)) {
    return { "Cache-Control": "private" };
  }
  return {
    "Cache-Control": `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}`,
    "CDN-Cache-Control": `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}`,
  };
}
