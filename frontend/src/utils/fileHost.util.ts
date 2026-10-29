// Mirrors the backend's file-host allowlist (`backend/src/utils/fileHosts.util.ts`).
// Hosts are classified as:
//  - "server": the page cannot be read cross-origin, so the backend resolves it
//    to a direct file (MediaFire, Bunkr, Dropbox, Google Drive, OneDrive, pCloud).
//  - "unsupported": a known file host we cannot resolve without an account or a
//    reverse-engineered API, so we say so instead of failing silently.
//  - null: not a known host → treated as a direct URL and fetched in the browser.
export type FileHostKind = "server" | "unsupported" | null;

// Hosts the backend can resolve to a direct download.
const SERVER_HOSTS = new Set([
  "mediafire.com",
  "www.mediafire.com",
  "dropbox.com",
  "www.dropbox.com",
  "db.tt",
  "drive.google.com",
  "docs.google.com",
  "1drv.ms",
  "onedrive.live.com",
  "pcloud.com",
  "www.pcloud.com",
  "e.pcloud.link",
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

// Known file hosts we do not support (account required or no public API).
const UNSUPPORTED_HOSTS = new Set([
  "gofile.io",
  "www.gofile.io",
  "mega.nz",
  "mega.io",
  "box.com",
  "www.box.com",
  "app.box.com",
  "wetransfer.com",
  "www.wetransfer.com",
  "we.tl",
  "transfernow.net",
  "www.transfernow.net",
  "swisstransfer.com",
  "www.swisstransfer.com",
  "fromsmash.com",
  "www.fromsmash.com",
  "filemail.com",
  "www.filemail.com",
  "icedrive.net",
  "www.icedrive.net",
  "sync.com",
  "www.sync.com",
  "proton.me",
  "www.proton.me",
  "drive.proton.me",
]);

const BUNKR_SUFFIX = /(^|\.)bunkr(r)?\.[a-z]{2,}$/;
const SHAREPOINT_SUFFIX = /\.sharepoint\.com$/;

/** Classifies a URL against the known file hosts. */
export const classifyFileHost = (raw: string): FileHostKind => {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (
    SERVER_HOSTS.has(host) ||
    BUNKR_SUFFIX.test(host) ||
    SHAREPOINT_SUFFIX.test(host)
  )
    return "server";
  if (UNSUPPORTED_HOSTS.has(host)) return "unsupported";
  return null;
};

/**
 * Whether a URL points at a file-host page the backend can resolve. Direct URLs
 * are fetched in the browser; only these are resolved server side.
 */
export const isFileHostUrl = (raw: string): boolean =>
  classifyFileHost(raw) === "server";
