import * as crypto from "crypto";
import { extname } from "path";
import { Readable } from "stream";
import { getFileMimeType } from "src/utils/mime.util";

export type ScanVerdict = "clean" | "suspicious" | "malicious";

export type AnalysisStats = {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
};

const SAFE_MEDIA_PREFIXES = ["image/", "video/", "audio/"];
const SAFE_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
]);
// Only used when mime-types cannot identify the extension.
const SAFE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".avif",
  ".heic",
  ".heif",
  ".ico",
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".wmv",
  ".flv",
  ".mpeg",
  ".mpg",
  ".3gp",
  ".ts",
  ".m2ts",
  ".ogv",
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".m4a",
  ".wma",
  ".aiff",
  ".aif",
  ".txt",
  ".csv",
  ".tsv",
  ".md",
  ".markdown",
  ".json",
  ".xml",
]);

/**
 * VirusTotal should only spend its free quota on files that can realistically
 * carry malware. Raster images, audio/video and plain structured text are
 * skipped; SVG stays in the scan set because it is scriptable XML.
 */
export function shouldScanFile(fileName: string): boolean {
  const mimeType = getFileMimeType(fileName, false);
  if (mimeType === "image/svg+xml") return true;
  if (SAFE_MEDIA_PREFIXES.some((prefix) => mimeType.startsWith(prefix)))
    return false;
  if (SAFE_MIME_TYPES.has(mimeType)) return false;
  if (
    mimeType === "application/octet-stream" &&
    SAFE_EXTENSIONS.has(extname(fileName).toLowerCase())
  )
    return false;
  return true;
}

export function parseAnalysisStats(
  attributes: Record<string, unknown> | undefined,
): AnalysisStats | undefined {
  if (!attributes) return undefined;
  const raw = attributes.last_analysis_stats ?? attributes.stats;
  if (!raw || typeof raw !== "object") return undefined;

  const read = (key: string) => {
    const value = Number((raw as Record<string, unknown>)[key]);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    malicious: read("malicious"),
    suspicious: read("suspicious"),
    harmless: read("harmless"),
    undetected: read("undetected"),
  };
}

export function getScanVerdict(
  stats: AnalysisStats | undefined,
): ScanVerdict | undefined {
  if (!stats) return undefined;
  if (stats.malicious > 0) return "malicious";
  if (stats.suspicious > 0) return "suspicious";
  if (stats.harmless + stats.undetected > 0) return "clean";
  return undefined;
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  fallbackMs: number,
  maxMs: number,
): number {
  if (!value) return fallbackMs;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(Math.max(seconds * 1000, 60_000), maxMs);

  const date = Date.parse(value);
  if (Number.isFinite(date))
    return Math.min(Math.max(date - Date.now(), 60_000), maxMs);

  return fallbackMs;
}

export async function sha256Stream(stream: Readable): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
