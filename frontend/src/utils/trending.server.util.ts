import type { TrendingCountry, TrendingShare } from "../types/share.type";

const TRENDING_CACHE_TTL_MS = 30_000;
const COUNTRIES_CACHE_TTL_MS = 5 * 60 * 1000;
const TRENDING_ERROR_CACHE_TTL_MS = 5_000;
const cache = new Map<
  number,
  { at: number; items: TrendingShare[] | undefined }
>();
let countriesCache:
  | { at: number; countries: TrendingCountry[] | undefined }
  | undefined;

/**
 * Loads the public trending list on the server. The backend already caches the
 * ranking briefly, so a matching module-level cache stops every SSR request
 * (widget pages and /trending) from reaching the API. The limit is part of the
 * cache key because the full page asks for 48 entries.
 */
export async function fetchTrending(
  apiUrl: string,
  limit?: number,
): Promise<TrendingShare[] | undefined> {
  const key = limit ?? 0;
  const cached = cache.get(key);
  const cacheTtl = cached?.items
    ? TRENDING_CACHE_TTL_MS
    : TRENDING_ERROR_CACHE_TTL_MS;
  if (cached && Date.now() - cached.at < cacheTtl) return cached.items;

  try {
    const query = limit ? `?limit=${limit}` : "";
    const response = await fetch(`${apiUrl}/api/shares/trending${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    const items = response.ok
      ? ((await response.json()) as TrendingShare[])
      : undefined;
    cache.set(key, { at: Date.now(), items });
    return items;
  } catch {
    cache.set(key, { at: Date.now(), items: undefined });
    return undefined;
  }
}

/**
 * Loads the country ranking for /trending. The backend caches the aggregate
 * for five minutes and sets the same edge TTL, so the server cache mirrors
 * that window and keeps SSR requests off the API.
 */
export async function fetchTrendingCountries(
  apiUrl: string,
): Promise<TrendingCountry[] | undefined> {
  const cacheTtl = countriesCache?.countries
    ? COUNTRIES_CACHE_TTL_MS
    : TRENDING_ERROR_CACHE_TTL_MS;
  if (countriesCache && Date.now() - countriesCache.at < cacheTtl)
    return countriesCache.countries;

  try {
    const response = await fetch(`${apiUrl}/api/shares/trending/countries`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    const countries = response.ok
      ? ((await response.json()) as TrendingCountry[])
      : undefined;
    countriesCache = { at: Date.now(), countries };
    return countries;
  } catch {
    countriesCache = { at: Date.now(), countries: undefined };
    return undefined;
  }
}
