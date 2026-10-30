import { fetchRemoteText } from "./remoteFetch.util";

export type ResolvedFile = { url: string; name?: string };

export type FileHostName =
  | "gofile"
  | "bunkr"
  | "mediafire"
  | "dropbox"
  | "gdrive"
  | "onedrive"
  | "pcloud"
  | "mega"
  | "box"
  | "wetransfer"
  | "transfernow"
  | "swisstransfer"
  | "smash"
  | "filemail"
  | "icedrive"
  | "sync"
  | "protondrive"
  | "pixeldrain"
  | "tmpfiles";

export class FileHostError extends Error {
  constructor(
    public readonly code: "gofile" | "resolve" | "folder" | "unsupported",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FileHostError";
  }
}

// Bunkr rotates domains often; match the common suffixes plus a fixed list.
const BUNKR_HOSTS = new Set([
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

// Exact hostnames (and their www. variants) mapped to a service key.
const EXACT_HOSTS: Record<string, FileHostName> = {
  "gofile.io": "gofile",
  "www.gofile.io": "gofile",
  "mediafire.com": "mediafire",
  "www.mediafire.com": "mediafire",
  "dropbox.com": "dropbox",
  "www.dropbox.com": "dropbox",
  "db.tt": "dropbox",
  "drive.google.com": "gdrive",
  "docs.google.com": "gdrive",
  "1drv.ms": "onedrive",
  "onedrive.live.com": "onedrive",
  "pcloud.com": "pcloud",
  "www.pcloud.com": "pcloud",
  "e.pcloud.link": "pcloud",
  "mega.nz": "mega",
  "mega.io": "mega",
  "box.com": "box",
  "www.box.com": "box",
  "app.box.com": "box",
  "wetransfer.com": "wetransfer",
  "www.wetransfer.com": "wetransfer",
  "we.tl": "wetransfer",
  "transfernow.net": "transfernow",
  "www.transfernow.net": "transfernow",
  "swisstransfer.com": "swisstransfer",
  "www.swisstransfer.com": "swisstransfer",
  "fromsmash.com": "smash",
  "www.fromsmash.com": "smash",
  "filemail.com": "filemail",
  "www.filemail.com": "filemail",
  "icedrive.net": "icedrive",
  "www.icedrive.net": "icedrive",
  "sync.com": "sync",
  "www.sync.com": "sync",
  "proton.me": "protondrive",
  "www.proton.me": "protondrive",
  "drive.proton.me": "protondrive",
  "pixeldrain.com": "pixeldrain",
  "www.pixeldrain.com": "pixeldrain",
  "tmpfiles.org": "tmpfiles",
  "www.tmpfiles.org": "tmpfiles",
};

const BUNKR_SUFFIX = /(^|\.)bunkr(r)?\.[a-z]{2,}$/;
const SHAREPOINT_SUFFIX = /\.sharepoint\.com$/;
const PCLOUD_SERVER = /^pc\d+\.pcloud\.com$/;

export function detectFileHost(rawUrl: string): FileHostName | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (BUNKR_HOSTS.has(host) || BUNKR_SUFFIX.test(host)) return "bunkr";
  if (SHAREPOINT_SUFFIX.test(host)) return "onedrive";
  if (PCLOUD_SERVER.test(host)) return "pcloud";
  return EXACT_HOSTS[host] ?? null;
}

// Hosts whose public page can be resolved to a direct download without an
// account. Everything else that is "detected" is reported as unsupported with
// a clear reason instead of being silently tried.
/**
 * Resolves a supported file-host page URL to one or more direct, publicly
 * fetchable URLs. Only public page HTML/JSON is parsed (no account
 * circumvention, no bot-protection bypass). The caller still runs every direct
 * URL through the SSRF-guarded downloader.
 */
export async function resolveFileHost(rawUrl: string): Promise<ResolvedFile[]> {
  const host = detectFileHost(rawUrl);
  switch (host) {
    case "bunkr":
      return resolveBunkr(rawUrl);
    case "mediafire":
      return resolveMediaFire(rawUrl);
    case "dropbox":
      return resolveDropbox(rawUrl);
    case "gdrive":
      return resolveGoogleDrive(rawUrl);
    case "onedrive":
      return resolveOneDrive(rawUrl);
    case "pcloud":
      return resolvePCloud(rawUrl);
    case "pixeldrain":
      return resolvePixeldrain(rawUrl);
    case "tmpfiles":
      return resolveTmpFiles(rawUrl);
    case "gofile":
      throw new FileHostError("gofile");
    case null:
      return [{ url: rawUrl }];
    default:
      throw new FileHostError("unsupported", `unsupported host: ${host}`);
  }
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\\//g, "/");
  }
}

function titleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!match) return undefined;
  const title = match[1]
    .replace(/\s*\|\s*Bunkr\s*$/i, "")
    .replace(/^Download\s+/i, "")
    .trim();
  return title || undefined;
}

function fileNameFromPath(pathname: string): string | undefined {
  const last = pathname.split("/").filter(Boolean).pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

async function resolveBunkr(rawUrl: string): Promise<ResolvedFile[]> {
  const { text } = await fetchRemoteText(rawUrl, {
    maxBytes: 4 * 1024 * 1024,
  });

  const cdns = [...text.matchAll(/var\s+jsCDN\s*=\s*"([^"]+)"/g)].map((match) =>
    decodeJsonString(match[1]),
  );
  const signRaw = text.match(/var\s+signUrl\s*=\s*"([^"]+)"/)?.[1];
  if (cdns.length === 0 || !signRaw)
    throw new FileHostError("resolve", "bunkr: no file found on the page");

  const signUrl = decodeJsonString(signRaw);
  const signHost = new URL(signUrl).hostname.toLowerCase();
  // The sign host is read from page content, so allowlist it before any request.
  if (!/(^|\.)cdn\.cr$/.test(signHost))
    throw new FileHostError("resolve", "bunkr: unexpected signing host");

  const fallbackName = titleFromHtml(text);
  const files: ResolvedFile[] = [];
  for (const cdn of cdns) {
    const url = new URL(cdn);
    if (!/(^|\.)cdn\.cr$/.test(url.hostname.toLowerCase()))
      throw new FileHostError("resolve", "bunkr: unexpected CDN host");

    const path = decodeURIComponent(url.pathname);
    const { text: signText } = await fetchRemoteText(
      `${signUrl}?path=${encodeURIComponent(path)}`,
      { headers: { Accept: "application/json" }, maxBytes: 64 * 1024 },
    );
    const signed = JSON.parse(signText) as { token?: string; ex?: number };
    if (!signed.token || signed.ex === undefined)
      throw new FileHostError("resolve", "bunkr: could not sign the file");

    url.searchParams.set("token", signed.token);
    url.searchParams.set("ex", String(signed.ex));
    files.push({
      url: url.toString(),
      name:
        fallbackName ?? decodeURIComponent(url.pathname.split("/").pop() ?? ""),
    });
  }
  return files;
}

/**
 * Extracts the direct download link from a MediaFire file page. MediaFire
 * exposes it either as a base64 `data-scrambled-url` or a plain
 * `download####.mediafire.com` link.
 */
export function parseMediaFireHtml(html: string): ResolvedFile[] {
  const scrambled = html.match(/data-scrambled-url="([^"]+)"/i)?.[1];
  let direct: string | undefined;
  if (scrambled) {
    try {
      direct = Buffer.from(scrambled, "base64").toString("utf8");
    } catch {
      direct = undefined;
    }
  }
  if (!direct || !/^https?:\/\//i.test(direct)) {
    direct =
      html.match(/href="(https:\/\/download[^"]+)"/i)?.[1] ??
      html.match(
        /(https?:\/\/download[0-9]+\.mediafire\.com\/[^"'\s\\]+)/i,
      )?.[1];
  }
  if (!direct || !/^https?:\/\//i.test(direct))
    throw new FileHostError("resolve", "mediafire: no download link found");
  // The download host is read from page content (or a base64 blob), so restrict
  // it to MediaFire's own download domain before the server fetches it. The
  // SSRF guards still apply, but this keeps the server from being steered to an
  // arbitrary public host by a tampered page.
  if (!safeMediaFireHost(direct))
    throw new FileHostError("resolve", "mediafire: unexpected download host");

  const name = decodeURIComponent(
    new URL(direct).pathname.split("/").pop() ?? "",
  );
  return [{ url: direct, name: name || undefined }];
}

/** The hostname when `raw` is a MediaFire download URL, otherwise undefined. */
function safeMediaFireHost(raw?: string): string | undefined {
  if (!raw || !/^https?:\/\//i.test(raw)) return undefined;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return /(^|\.)mediafire\.com$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

async function resolveMediaFire(rawUrl: string): Promise<ResolvedFile[]> {
  if (/\/folder\//i.test(rawUrl))
    throw new FileHostError(
      "folder",
      "mediafire: folder links are not supported",
    );

  const { text } = await fetchRemoteText(rawUrl, {
    maxBytes: 4 * 1024 * 1024,
  });
  return parseMediaFireHtml(text);
}

/**
 * Dropbox share links become a direct download by adding `dl=1`. Dropbox then
 * redirects to its CDN, which the SSRF-guarded downloader follows. Folder
 * links are not supported.
 */
export function resolveDropbox(rawUrl: string): ResolvedFile[] {
  const url = new URL(rawUrl);
  // `/sh/…` and `/home/…?preview=…` are folder links, which need the Dropbox
  // API; individual files under `/s/…` or `/scl/fi/…` download with `dl=1`.
  if (/(^|\/)(folder|sh|home)(\/|$)/i.test(url.pathname))
    throw new FileHostError(
      "folder",
      "dropbox: folder links are not supported",
    );
  url.searchParams.set("dl", "1");
  return [{ url: url.toString(), name: fileNameFromPath(url.pathname) }];
}

/** Pulls the file id out of the common Google Drive share URL shapes. */
export function googleDriveFileId(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const fromPath =
    url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ??
    url.pathname.match(/\/d\/([^/]+)/)?.[1];
  if (fromPath) return fromPath;
  const id = url.searchParams.get("id");
  return id || undefined;
}

/**
 * Google Drive: build the public download URL from the file id. Large files
 * behind a virus-scan confirmation page cannot be downloaded without cookies,
 * so the caller rejects an HTML response body.
 */
export function resolveGoogleDrive(rawUrl: string): ResolvedFile[] {
  const url = new URL(rawUrl);
  if (/\/folders\//.test(url.pathname))
    throw new FileHostError("folder", "gdrive: folder links are not supported");
  const id = googleDriveFileId(rawUrl);
  if (!id) throw new FileHostError("unsupported", "gdrive: no file id");
  return [
    {
      url: `https://drive.usercontent.google.com/download?export=download&id=${encodeURIComponent(
        id,
      )}&confirm=t`,
    },
  ];
}

/**
 * OneDrive / SharePoint: the share URL is base64url-encoded into the
 * `shares/u!<id>/root/content` API, which redirects to the file.
 */
export function oneDriveShareId(rawUrl: string): string {
  return Buffer.from(rawUrl, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function resolveOneDrive(rawUrl: string): ResolvedFile[] {
  return [
    {
      url: `https://api.onedrive.com/v1.0/shares/u!${oneDriveShareId(
        rawUrl,
      )}/root/content`,
    },
  ];
}

type PCloudNode = {
  fileid?: number;
  name?: string;
  isfolder?: boolean;
  contents?: PCloudNode[];
  metadata?: PCloudNode;
};

/** Walks a pCloud public-link tree and returns every downloadable file. */
function collectPCloudFiles(root: PCloudNode | undefined): PCloudNode[] {
  if (!root) return [];
  const node = root.metadata ?? root;
  if (node.isfolder && Array.isArray(node.contents))
    return node.contents.flatMap((child) => collectPCloudFiles(child));
  if (node.fileid) return [node];
  return [];
}

/**
 * pCloud public links (`e.pcloud.link/publink/show?code=…`): list the public
 * link, then ask for a per-file download host. Pure JSON API, no HTML parsing.
 */
async function resolvePCloud(rawUrl: string): Promise<ResolvedFile[]> {
  const url = new URL(rawUrl);
  const code = url.searchParams.get("code");
  if (!code) throw new FileHostError("unsupported", "pcloud: no link code");

  const list = await fetchRemoteText(
    `https://api.pcloud.com/showpublink?code=${encodeURIComponent(code)}`,
    { headers: { Accept: "application/json" }, maxBytes: 1024 * 1024 },
  );
  let data: { result?: number; metadata?: PCloudNode; error?: string };
  try {
    data = JSON.parse(list.text);
  } catch {
    throw new FileHostError("resolve", "pcloud: invalid response");
  }
  if (data.result !== 0)
    throw new FileHostError("resolve", `pcloud: ${data.error ?? "error"}`);

  const nodes = collectPCloudFiles(data);
  if (nodes.length === 0)
    throw new FileHostError("resolve", "pcloud: no files in the link");

  const files: ResolvedFile[] = [];
  for (const node of nodes) {
    const { text } = await fetchRemoteText(
      `https://api.pcloud.com/getpublinkdownload?code=${encodeURIComponent(
        code,
      )}&fileid=${node.fileid}`,
      { headers: { Accept: "application/json" }, maxBytes: 64 * 1024 },
    );
    const download = JSON.parse(text) as {
      result?: number;
      hosts?: string[];
      path?: string;
    };
    if (download.result !== 0 || !download.hosts?.length || !download.path)
      throw new FileHostError(
        "resolve",
        "pcloud: could not build a download link",
      );
    files.push({
      url: `https://${download.hosts[0]}${download.path}`,
      name: node.name,
    });
  }
  return files;
}

/**
 * Pixeldrain: `/u/<id>` (and `/file/<id>`) map to the public download API. The
 * `/api/file/<id>` form is already a direct link and is passed through. `/l/`
 * is a folder (list) link.
 */
export function resolvePixeldrain(rawUrl: string): ResolvedFile[] {
  const url = new URL(rawUrl);
  if (/^\/api\/file\/[A-Za-z0-9]+/.test(url.pathname))
    return [{ url: url.toString(), name: fileNameFromPath(url.pathname) }];
  if (/^\/l\//.test(url.pathname))
    throw new FileHostError(
      "folder",
      "pixeldrain: list links are not supported",
    );
  const id = url.pathname.match(/^\/(?:u|d|file)\/([A-Za-z0-9]+)/)?.[1];
  if (!id) throw new FileHostError("unsupported", "pixeldrain: no file id");
  return [{ url: `https://pixeldrain.com/api/file/${id}?download` }];
}

/**
 * tmpfiles.org: `/<id>/<name>` is an HTML page whose `/dl/` path is the direct
 * file, so the page URL is rewritten to the download URL.
 */
export function resolveTmpFiles(rawUrl: string): ResolvedFile[] {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/^\/(\d+)\/(.+)$/);
  if (!match) throw new FileHostError("unsupported", "tmpfiles: no file id");
  return [
    {
      url: `https://tmpfiles.org/dl/${match[1]}/${match[2]}`,
      name: fileNameFromPath(match[2]),
    },
  ];
}
