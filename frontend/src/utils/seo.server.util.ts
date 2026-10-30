import type { IncomingMessage } from "http";
import Config from "../types/config.type";
import { ShareSeo, TrendingCountry, TrendingShare } from "../types/share.type";
import { getConfiguredSiteUrl, normalizeBaseUrl } from "./seo.util";

const ERROR_CACHE_MS = 5_000;
const SEO_CACHE_MAX_ENTRIES = 500;

type ShareSeoResult =
  | { status: "ok"; data: ShareSeo }
  | { status: "not-found" }
  | { status: "error" };

type CachedSeo = { at: number; value: ShareSeoResult; error?: boolean };

const seoCache = new Map<string, CachedSeo>();

// Share URLs are unbounded, so keep the per-process negative cache small
// instead of retaining every share ever crawled for the process lifetime.
function cacheSeo(shareId: string, entry: CachedSeo) {
  const now = Date.now();
  for (const [id, cached] of seoCache) {
    if (now - cached.at < ERROR_CACHE_MS) continue;
    seoCache.delete(id);
  }
  if (seoCache.size >= SEO_CACHE_MAX_ENTRIES) {
    const oldest = seoCache.keys().next().value;
    if (oldest) seoCache.delete(oldest);
  }
  seoCache.set(shareId, entry);
}

/**
 * Uses the configured public URL in production. Local development and tests
 * fall back to the proxy's forwarded host so generated sitemap/canonical URLs
 * point at the address the visitor actually opened.
 */
export function resolveSiteUrl(
  request: IncomingMessage | undefined,
  config: Config[],
): string {
  const configured = getConfiguredSiteUrl(config);
  const localConfigured =
    !configured ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
  if (!localConfigured) return configured;
  // In production the public URL must come from configuration. Deriving it
  // from the request would let an attacker pin crawler artifacts (and their
  // public cache entries) to an arbitrary Host/X-Forwarded-Host value.
  if (process.env.NODE_ENV === "production") return "";
  if (!request) return configured;

  const forwardedHost = request.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || request.headers.host;
  if (!host) return configured;

  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(",")[0]?.trim() ||
      ((request.socket as { encrypted?: boolean })?.encrypted
        ? "https"
        : "http");

  return normalizeBaseUrl(`${proto}://${host}`);
}

/**
 * Server-renders the first listing batch so /trending and /new contain links
 * and cards in the first HTML response. The client component still falls back
 * to its own request when the backend is unavailable or returns nothing.
 */
export async function fetchShareList(
  apiUrl: string,
  path: "trending" | "recent" | "recent-files",
  limit: number,
): Promise<TrendingShare[] | null> {
  try {
    const response = await fetch(
      `${apiUrl}/api/shares/${path}?limit=${limit}`,
      {
        // The API response is public and edge-cacheable. getServerSideProps
        // does not populate Next's fetch cache, so this is a plain request;
        // the backend/edge TTL is the actual cache.
        signal: AbortSignal.timeout(2000),
      },
    );
    // `null` means the backend did not answer; the caller must not cache that
    // as a valid (empty) listing.
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? (data as TrendingShare[]) : null;
  } catch {
    return null;
  }
}

/**
 * Server-renders the country panel so /trending costs one HTML request instead
 * of a second client API call after hydration. `null` marks a backend failure.
 */
export async function fetchTrendingCountries(
  apiUrl: string,
): Promise<TrendingCountry[] | null> {
  try {
    const response = await fetch(`${apiUrl}/api/shares/trending/countries`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? (data as TrendingCountry[]) : null;
  } catch {
    return null;
  }
}

export async function fetchShareSeo(
  apiUrl: string,
  shareId: string,
): Promise<ShareSeoResult> {
  // Only failures are briefly memoized. A positive share payload is never held
  // in this process: after a password/lockdown the SSR page must immediately
  // stop rendering the old title, description and file names. The backend's
  // own SEO cache is invalidated per share on every mutation.
  const cached = seoCache.get(shareId);
  if (cached?.error && Date.now() - cached.at < ERROR_CACHE_MS) {
    return cached.value;
  }
  if (cached && !cached.error) seoCache.delete(shareId);

  try {
    const response = await fetch(
      `${apiUrl}/api/shares/${encodeURIComponent(shareId)}/seo`,
      { cache: "no-store", signal: AbortSignal.timeout(1500) },
    );
    if (response.status === 404) {
      const value: ShareSeoResult = { status: "not-found" };
      cacheSeo(shareId, { at: Date.now(), value, error: true });
      return value;
    }
    if (!response.ok) throw new Error(`SEO fetch failed: ${response.status}`);

    const value: ShareSeoResult = {
      status: "ok",
      data: (await response.json()) as ShareSeo,
    };
    seoCache.delete(shareId);
    return value;
  } catch {
    // A short negative cache stops a slow backend from being retried on every
    // request, while still recovering quickly once it is reachable again.
    const value: ShareSeoResult = { status: "error" };
    cacheSeo(shareId, { at: Date.now(), value, error: true });
    return value;
  }
}
