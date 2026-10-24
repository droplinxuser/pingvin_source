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
