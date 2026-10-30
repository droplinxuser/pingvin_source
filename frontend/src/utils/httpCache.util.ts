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
  // Middleware already decided whether this response may be shared (it sends
  // no-store for signed-in users, non-default languages, dark theme and query
  // strings). Never turn that decision back into a public header.
  if (response.hasHeader("Cache-Control")) return;

  const value = `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
  response.setHeader("Cache-Control", value);
  response.setHeader("CDN-Cache-Control", value);
  response.setHeader("Cloudflare-CDN-Cache-Control", value);
}

/**
 * Public listing pages (trending, new media/files) share the same rule: a
 * failed backend response and every `_next/data` client-navigation payload
 * must stay out of the CDN, while a successful shell may be shared briefly.
 */
export function setListingCacheHeaders(
  req: { url?: string },
  response: ServerResponse,
  succeeded: boolean,
) {
  if (req.url?.startsWith("/_next/data/") || !succeeded)
    setNoStoreHeaders(response);
  else setPublicCacheHeaders(response, 60, 30);
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
