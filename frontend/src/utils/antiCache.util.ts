import { ServerResponse } from "http";

// Strict anti-caching headers used for share pages. They instruct browsers,
// origin servers and CDN edges (such as Cloudflare) to never cache the
// response, since share page data changes on every visit (rolling expiration,
// view counters, ...).
export const NO_STORE_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
};

export const setNoStoreCacheHeaders = (res: ServerResponse) => {
  Object.entries(NO_STORE_CACHE_HEADERS).forEach(([name, value]) =>
    res.setHeader(name, value),
  );
};
