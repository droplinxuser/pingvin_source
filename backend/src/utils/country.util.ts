// Field prefix used by the hourly page-view and trending country hashes.
export const COUNTRY_FIELD_PREFIX = "c:";

export function isCountryCode(code?: string): code is string {
  return !!code && /^[A-Z]{2}$/.test(code) && code !== "XX";
}

/**
 * Normalises the two-letter country code supplied by Cloudflare. Keeping this
 * in one place makes page views, trending shares and uploader metadata agree.
 */
export function normalizeCountryCode(country?: string): string | undefined {
  const code = country?.trim().toUpperCase();
  return isCountryCode(code) ? code : undefined;
}
