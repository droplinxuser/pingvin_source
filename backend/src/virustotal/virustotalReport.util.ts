import { promises as fs } from "fs";
import { join } from "path";
import { SHARE_DIRECTORY } from "src/constants";
import { writeFileAtomic } from "src/utils/fileWrite.util";
import { KeyedLock } from "src/utils/keyedLock.util";

/**
 * Per-share VirusTotal results, kept as a flat JSON file in the share's own
 * directory (`<share>/virustotal.json`), beside the file bytes. It records a
 * compact verdict for every scanned file so the share page can show a
 * "scanned / safe" indicator without a database column or an extra query.
 */
const REPORT_FILE = "virustotal.json";
const REPORT_VERSION = 1;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_ENTRIES = 2000;
const SAFE_ID = /^[\w=-]+$/;

export type VirusTotalFileVerdict = "clean" | "suspicious";

export type VirusTotalFileReport = {
  verdict: VirusTotalFileVerdict;
  malicious?: number;
  suspicious?: number;
  harmless?: number;
  undetected?: number;
  engines?: number;
  hash?: string;
  scannedAt: string;
};

type ReportDocument = {
  version: number;
  files: Record<string, VirusTotalFileReport>;
};

const lock = new KeyedLock();

export function virusTotalReportPath(shareId: string): string | undefined {
  if (!SAFE_ID.test(shareId)) return undefined;
  return join(SHARE_DIRECTORY, shareId, REPORT_FILE);
}

function parseDocument(raw: string): ReportDocument | undefined {
  try {
    const parsed = JSON.parse(raw) as ReportDocument | undefined;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (!parsed.files || typeof parsed.files !== "object") return undefined;
    return { version: Number(parsed.version) || 0, files: parsed.files };
  } catch {
    return undefined;
  }
}

/** Reads the per-file verdicts; missing or unreadable files yield `{}`. */
export async function readVirusTotalReport(
  shareId: string,
): Promise<Record<string, VirusTotalFileReport>> {
  const path = virusTotalReportPath(shareId);
  if (!path) return {};
  try {
    const stat = await fs.stat(path);
    if (stat.size <= 0 || stat.size > MAX_REPORT_BYTES) return {};
    const document = parseDocument(await fs.readFile(path, "utf8"));
    return document?.files ?? {};
  } catch {
    return {};
  }
}

/** Stores one file's verdict, merging it into the existing report atomically. */
export async function writeVirusTotalResult(
  shareId: string,
  fileId: string,
  entry: VirusTotalFileReport,
): Promise<void> {
  const path = virusTotalReportPath(shareId);
  if (!path || !SAFE_ID.test(fileId)) return;

  await lock.run(shareId, async () => {
    const files = await readVirusTotalReport(shareId);
    files[fileId] = entry;

    const keys = Object.keys(files);
    if (keys.length > MAX_ENTRIES) {
      // Drop the oldest scans first so a folder share cannot grow the file
      // without bound. Entries are keyed by scannedAt for the trim only.
      keys.sort((a, b) =>
        (files[a].scannedAt ?? "").localeCompare(files[b].scannedAt ?? ""),
      );
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES))
        delete files[key];
    }

    const document: ReportDocument = { version: REPORT_VERSION, files };
    // `requireDirectory` keeps a late write from recreating a deleted share
    // directory: a removed share simply has no report to write.
    await writeFileAtomic(path, JSON.stringify(document), {
      requireDirectory: true,
    });
  });
}

/** Drops a file's entry (used when a file is removed from a share). */
export async function removeVirusTotalResult(
  shareId: string,
  fileId: string,
): Promise<void> {
  const path = virusTotalReportPath(shareId);
  if (!path) return;

  await lock.run(shareId, async () => {
    const files = await readVirusTotalReport(shareId);
    if (!(fileId in files)) return;
    delete files[fileId];
    const document: ReportDocument = { version: REPORT_VERSION, files };
    await writeFileAtomic(path, JSON.stringify(document), {
      requireDirectory: true,
    });
  });
}
