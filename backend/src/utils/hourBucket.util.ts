/**
 * Shared hourly clock for the Valkey counters (page views, downloads, trending
 * and the per-country geo hashes).
 *
 * The trending ranking, its download tie-break and the country panel all read
 * the same 24 hourly buckets, so they must agree on the hour boundary and on
 * how long a bucket has to survive. Keeping one definition prevents a future
 * adjustment in one reader from silently shifting the window the others use.
 */
export const HOUR_MS = 60 * 60 * 1000;
export const HOUR_WINDOW = 24;

/** The bucket index for `now` (so tests can pass a fixed timestamp). */
export function currentHour(now = Date.now()): number {
  return Math.floor(now / HOUR_MS);
}

/**
 * TTL for a bucket that has to stay readable for the whole window it belongs
 * to, plus one hour of slack so a read that starts just before the boundary
 * does not race the expiry.
 */
export function hourBucketTtlSeconds(windowHours = HOUR_WINDOW): number {
  return (windowHours + 1) * 60 * 60;
}
