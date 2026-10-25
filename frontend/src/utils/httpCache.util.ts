import type { ServerResponse } from "http";

/**
 * Cache headers for generated text/XML/JSON documents. Browsers always
 * revalidate; the CDN keeps a shared copy and can serve stale during
 * revalidation.
 */
export function setPublicCacheHeaders(
  response: ServerResponse,
  maxAge: number,
  staleWhileRevalidate = 86_400,
) {
  const value = `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
  response.setHeader("Cache-Control", value);
  response.setHeader("CDN-Cache-Control", value);
  response.setHeader("Cloudflare-CDN-Cache-Control", value);
}

/**
 * Overrides the public page-shell headers when the server-rendered response is
 * a transient error. Without this, the middleware's short public TTL could
 * pin a backend hiccup at the edge.
 */
export function setNoStoreHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Cloudflare-CDN-Cache-Control", "no-store");
}
