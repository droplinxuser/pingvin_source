import type { IncomingMessage } from "http";
import Config from "../types/config.type";
import { ShareSeo, TrendingShare } from "../types/share.type";
import { getConfiguredSiteUrl, normalizeBaseUrl } from "./seo.util";

const SEO_CACHE_MS = 30_000;
const ERROR_CACHE_MS = 5_000;
const SEO_CACHE_MAX_ENTRIES = 500;

type ShareSeoResult =
  | { status: "ok"; data: ShareSeo }
  | { status: "not-found" }
  | { status: "error" };

type CachedSeo = { at: number; value: ShareSeoResult; error?: boolean };

const seoCache = new Map<string, CachedSeo>();

// Share URLs are unbounded, so keep the per-process SSR cache small instead of
// retaining every share ever crawled for the lifetime of the frontend.
function cacheSeo(shareId: string, entry: CachedSeo) {
  const now = Date.now();
  for (const [id, cached] of seoCache) {
    if (now - cached.at < (cached.error ? ERROR_CACHE_MS : SEO_CACHE_MS))
      continue;
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
  path: "trending" | "recent",
  limit: number,
): Promise<TrendingShare[]> {
  try {
    const response = await fetch(
      `${apiUrl}/api/shares/${path}?limit=${limit}`,
      {
        // The API response is already public and edge-cacheable; reuse it in
        // Next's data cache too when the HTML cache is bypassed.
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? (data as TrendingShare[]) : [];
  } catch {
    return [];
  }
}

export async function fetchShareSeo(
  apiUrl: string,
  shareId: string,
): Promise<ShareSeoResult> {
  const cached = seoCache.get(shareId);
  if (cached) {
    const ttl = cached.error ? ERROR_CACHE_MS : SEO_CACHE_MS;
    if (Date.now() - cached.at < ttl) return cached.value;
  }

  try {
    const response = await fetch(
      `${apiUrl}/api/shares/${encodeURIComponent(shareId)}/seo`,
      { cache: "no-store", signal: AbortSignal.timeout(1500) },
    );
    if (response.status === 404) {
      const value: ShareSeoResult = { status: "not-found" };
      cacheSeo(shareId, { at: Date.now(), value });
      return value;
    }
    if (!response.ok) throw new Error(`SEO fetch failed: ${response.status}`);

    const value: ShareSeoResult = {
      status: "ok",
      data: (await response.json()) as ShareSeo,
    };
    cacheSeo(shareId, { at: Date.now(), value });
    return value;
  } catch {
    // A short negative cache stops a slow backend from being retried on every
    // request, while still recovering quickly once it is reachable again.
    const value: ShareSeoResult = { status: "error" };
    cacheSeo(shareId, { at: Date.now(), value, error: true });
    return value;
  }
}
