import { ServerResponse } from "http";
import i18nUtil from "./i18n.util";

// Cacheable public pages (home, legal pages) can be stored on Cloudflare for
// a month. Browsers revalidate on every navigation so a new deployment is
// picked up immediately; the CDN keeps serving the cached copy in the
// meantime.
export const PUBLIC_PAGE_CACHE_MAX_AGE = 60 * 60 * 24 * 30;
const PUBLIC_PAGE_CACHE_VALUE = `public, max-age=0, s-maxage=${PUBLIC_PAGE_CACHE_MAX_AGE}, stale-while-revalidate=86400`;
const PUBLIC_PAGE_ROUTES = new Set(["/", "/imprint", "/privacy"]);

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

export const setPublicPageCacheHeaders = (res: ServerResponse) => {
  res.setHeader("Cache-Control", PUBLIC_PAGE_CACHE_VALUE);
  res.setHeader(
    "CDN-Cache-Control",
    `public, s-maxage=${PUBLIC_PAGE_CACHE_MAX_AGE}, stale-while-revalidate=86400`,
  );
  res.setHeader(
    "Cloudflare-CDN-Cache-Control",
    `public, s-maxage=${PUBLIC_PAGE_CACHE_MAX_AGE}, stale-while-revalidate=86400`,
  );
  res.setHeader("Vary", "Accept-Encoding, Accept-Language, Cookie");
};

export const setPublicPageCacheHeadersForRequest = (
  res: ServerResponse,
  options: {
    url?: string;
    hasUser: boolean;
    isConfigFallback?: boolean;
    language?: string;
    defaultLanguage?: string;
  },
) => {
  const path = options.url?.split("?")[0];
  if (
    !path ||
    options.hasUser ||
    options.isConfigFallback ||
    !PUBLIC_PAGE_ROUTES.has(path)
  )
    return;

  const pageLanguage = i18nUtil.getLocaleByCode(
    options.language || "en-US",
  ).code;
  const defaultPageLanguage = i18nUtil.getLocaleByCode(
    options.defaultLanguage || "en-US",
  ).code;
  if (pageLanguage !== defaultPageLanguage) return;

  setPublicPageCacheHeaders(res);
};
