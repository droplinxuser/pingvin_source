// Mirrors the backend's file-host allowlist (`backend/src/utils/fileHosts.util.ts`).
// Only these hosts are handed to the server for resolution; their pages cannot
// be read from the browser (no CORS), so they need a server-side resolver.
const FIXED_HOSTS = new Set([
  "gofile.io",
  "www.gofile.io",
  "mediafire.com",
  "www.mediafire.com",
  "bunkr.cr",
  "bunkr.si",
  "bunkr.su",
  "bunkr.ru",
  "bunkrr.su",
  "bunkrr.ru",
  "bunkr.sk",
  "bunkr.site",
  "bunkr.ws",
  "bunkr.black",
  "bunkr.red",
  "bunkr.media",
  "bunkr.ph",
  "bunkr.albums",
]);

/**
 * Whether a URL points at a supported file-host page rather than a direct file
 * URL. Direct URLs are fetched in the browser; only these are resolved server
 * side.
 */
export const isFileHostUrl = (raw: string): boolean => {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (FIXED_HOSTS.has(host)) return true;
  return /(^|\.)bunkr\.[a-z]{2,}$/.test(host) || /(^|\.)bunkrr\.[a-z]{2,}$/.test(host);
};
