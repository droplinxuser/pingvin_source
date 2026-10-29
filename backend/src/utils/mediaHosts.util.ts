import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";

/**
 * Server-side media (video/audio) import via yt-dlp. yt-dlp is a general
 * extractor, so it is only ever pointed at an explicit allowlist of well-known
 * public platforms: running it on an arbitrary URL would turn the endpoint into
 * a request proxy and widen the SSRF surface of the server. Unknown hosts stay
 * browser-only (frontend `upload.util.ts`), and every chunk still flows through
 * the normal upload pipeline (quota, size limits, VirusTotal/ClamAV hooks).
 */
export class MediaDownloadError extends Error {
  constructor(
    public readonly reason: "unavailable" | "too_large" | "timeout" | "failed",
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "MediaDownloadError";
  }
}

export type DownloadedMedia = { path: string; size: number; name?: string };

// Exact hostnames (and their www/mobile variants) that may be handed to yt-dlp.
const MEDIA_HOSTS = new Set<string>([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
  "dailymotion.com",
  "www.dailymotion.com",
  "dai.ly",
  "twitch.tv",
  "www.twitch.tv",
  "m.twitch.tv",
  "clips.twitch.tv",
  "streamable.com",
  "www.streamable.com",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "fb.watch",
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "np.reddit.com",
  "v.redd.it",
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
  "on.soundcloud.com",
  "mixcloud.com",
  "www.mixcloud.com",
  "imgur.com",
  "www.imgur.com",
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
  "b23.tv",
  "nicovideo.jp",
  "www.nicovideo.jp",
  "ted.com",
  "www.ted.com",
  "streamja.com",
  "www.streamja.com",
]);

// A few platforms serve media from many subdomains (a user or a CDN shard).
const MEDIA_HOST_SUFFIXES = [
  /(^|\.)bandcamp\.com$/,
  /(^|\.)bilibili\.com$/,
  /(^|\.)archive\.org$/,
  /(^|\.)odysee\.com$/,
  /(^|\.)rumble\.com$/,
  /(^|\.)bitchute\.com$/,
];

/**
 * Returns the allowlisted media hostname for a URL, or null when it is not a
 * recognised public media platform.
 */
export function detectMediaHost(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (MEDIA_HOSTS.has(host)) return host;
  if (MEDIA_HOST_SUFFIXES.some((suffix) => suffix.test(host))) return host;
  return null;
}

let availabilityChecked = false;
let ytDlpAvailable = false;

/** Whether the yt-dlp binary is usable. Cached for the process lifetime. */
export async function isYtDlpAvailable(): Promise<boolean> {
  if (availabilityChecked) return ytDlpAvailable;
  ytDlpAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn("yt-dlp", ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  availabilityChecked = true;
  return ytDlpAvailable;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDERR_BYTES = 8 * 1024;
// A title-derived file name also gives the uploaded file a readable name. The
// byte cap keeps a long title within the upload DTO's name limit.
const OUTPUT_TEMPLATE = "%(title).120B.%(ext)s";

/**
 * Downloads a single media item with yt-dlp into `destDirectory`. The caller
 * must have validated the URL against `detectMediaHost`. Playlists are
 * disabled, output is bounded by size and time, and the process runs with no
 * user config so it cannot be steered by a yt-dlp config file on the host.
 */
export async function downloadMediaWithYtDlp(
  rawUrl: string,
  destDirectory: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<DownloadedMedia> {
  if (!(await isYtDlpAvailable()))
    throw new MediaDownloadError("unavailable", "yt-dlp is not installed");

  await fs.mkdir(destDirectory, { recursive: true });

  const args = [
    "--ignore-config",
    "--no-cache-dir",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--no-part",
    "--no-mtime",
    "--restrict-filenames",
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--socket-timeout",
    "15",
    "--merge-output-format",
    "mp4",
    // Prefer a single progressive file (no ffmpeg merge needed); fall back to
    // merging the best separate video/audio streams when none exists.
    "-f",
    "best[acodec!=none][vcodec!=none]/bv*+ba/b",
    "-o",
    join(destDirectory, OUTPUT_TEMPLATE),
  ];
  if (options.maxBytes && options.maxBytes > 0)
    args.push("--max-filesize", String(options.maxBytes));
  // Some platforms (notably YouTube) require a signed-in cookie to serve a
  // datacenter IP. An operator can point YTDLP_COOKIES_FILE at a Netscape
  // cookie jar; it is optional and ignored when unset.
  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  if (cookiesFile) args.push("--cookies", cookiesFile);
  // `--` stops a crafted URL from being parsed as an option.
  args.push("--", rawUrl);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn("yt-dlp", args, {
    cwd: destDirectory,
    // Pin HOME and the cache dir so nothing is read from or written to the
    // service account's home directory.
    env: { ...process.env, HOME: destDirectory },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new MediaDownloadError("timeout"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new MediaDownloadError("failed", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    if (/max-filesize|larger than|file is larger/i.test(stderr))
      throw new MediaDownloadError("too_large");
    throw new MediaDownloadError(
      "failed",
      stderr.trim().slice(0, 500) || `yt-dlp exited with ${exitCode}`,
    );
  }

  const best = await largestFile(destDirectory);
  if (!best)
    throw new MediaDownloadError("failed", "yt-dlp produced no output file");
  if (options.maxBytes && best.size > options.maxBytes)
    throw new MediaDownloadError("too_large");

  return { path: best.path, size: best.size, name: best.name };
}

async function largestFile(
  directory: string,
): Promise<{ path: string; size: number; name: string } | undefined> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return undefined;
  }
  let best: { path: string; size: number; name: string } | undefined;
  for (const entry of entries) {
    if (entry.endsWith(".part") || entry.endsWith(".ytdl")) continue;
    const path = join(directory, entry);
    const stat = await fs.stat(path).catch(() => undefined);
    if (!stat?.isFile()) continue;
    if (!best || stat.size > best.size)
      best = { path, size: stat.size, name: entry };
  }
  return best;
}
