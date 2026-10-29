import { fetchRemoteText } from "./remoteFetch.util";

export type ResolvedFile = { url: string; name?: string };

export type FileHostName = "gofile" | "bunkr" | "mediafire";

export class FileHostError extends Error {
  constructor(
    public readonly code: "gofile" | "resolve" | "folder",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FileHostError";
  }
}

const GOFILE_HOSTS = new Set(["gofile.io", "www.gofile.io"]);
const MEDIAFIRE_HOSTS = new Set(["mediafire.com", "www.mediafire.com"]);
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

export function detectFileHost(rawUrl: string): FileHostName | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (GOFILE_HOSTS.has(host)) return "gofile";
  if (MEDIAFIRE_HOSTS.has(host)) return "mediafire";
  if (
    BUNKR_HOSTS.has(host) ||
    /(^|\.)bunkr\.[a-z]{2,}$/.test(host) ||
    /(^|\.)bunkrr\.[a-z]{2,}$/.test(host)
  )
    return "bunkr";
  return null;
}

/**
 * Resolves a supported file-host page URL to one or more direct, publicly
 * fetchable URLs. Only public page HTML is parsed (no account circumvention).
 * The caller still runs every direct URL through the SSRF-guarded downloader.
 */
export async function resolveFileHost(rawUrl: string): Promise<ResolvedFile[]> {
  const host = detectFileHost(rawUrl);
  if (host === "bunkr") return resolveBunkr(rawUrl);
  if (host === "mediafire") return resolveMediaFire(rawUrl);
  if (host === "gofile") throw new FileHostError("gofile");
  return [{ url: rawUrl }];
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
      name: fallbackName ?? decodeURIComponent(url.pathname.split("/").pop() ?? ""),
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

  const name = decodeURIComponent(
    new URL(direct).pathname.split("/").pop() ?? "",
  );
  return [{ url: direct, name: name || undefined }];
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
