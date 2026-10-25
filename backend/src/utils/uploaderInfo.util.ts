import { Logger } from "@nestjs/common";
import * as Bowser from "bowser";
import { Request } from "express";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { SHARE_DIRECTORY } from "../constants";
import { normalizeCountryCode } from "./country.util";

const FILE_NAME = "uploader.json";
export const MAX_VISITORS = 21;
const FIELDS = [
  "country",
  "city",
  "region",
  "timezone",
  "browser",
  "browserVersion",
  "os",
  "osVersion",
  "deviceType",
  "createdAt",
] as const;
const VISITOR_FIELDS = [
  "country",
  "city",
  "os",
  "browser",
  "referrer",
  "createdAt",
] as const;
const logger = new Logger("UploaderInfo");
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export type ShareVisitor = Partial<
  Record<(typeof VISITOR_FIELDS)[number], string>
> & {
  createdAt: string;
};

export type UploaderInfo = Partial<Record<(typeof FIELDS)[number], string>> & {
  createdAt: string;
  visitors?: ShareVisitor[];
};

const OS_NAMES: Record<string, string> = {
  "chrome os": "ChromeOS",
};
const BROWSER_NAMES: Record<string, string> = {
  "Microsoft Edge": "Edge",
  "Samsung Internet for Android": "Samsung Internet",
};
const PLATFORM_NAMES: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
  "chrome os": "ChromeOS",
};

function decodeText(value: string): string {
  try {
    value = decodeURIComponent(value);
  } catch {
    // Not percent-encoded; keep the original value.
  }

  // Node exposes header bytes as Latin-1, while Cloudflare sends UTF-8.
  // Re-decode only when the Latin-1 bytes form valid UTF-8, so already
  // correct values such as "Dasmariñas" are left untouched.
  if (/[\u0080-\u00ff]/.test(value)) {
    try {
      return UTF8_DECODER.decode(Buffer.from(value, "latin1"));
    } catch {
      // Already valid text; keep it.
    }
  }

  return value;
}

function getHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  const header = Array.isArray(value) ? value[0] : value;
  return header ? decodeText(header) : undefined;
}

function parseUserAgent(
  userAgent = "",
  platform?: string,
  mobileHint?: string,
) {
  const parsed = userAgent ? Bowser.parse(userAgent) : undefined;
  const platformName = platform?.replaceAll('"', "").trim().toLowerCase();
  const parsedOs = parsed?.os.name;
  const osName = parsedOs
    ? (OS_NAMES[parsedOs.toLowerCase()] ?? parsedOs)
    : PLATFORM_NAMES[platformName ?? ""];
  const braveVersion = userAgent.match(/Brave\/([\d.]+)/)?.[1];
  const parsedBrowser = parsed?.browser.name;
  const browserName = braveVersion
    ? "Brave"
    : parsedBrowser
      ? (BROWSER_NAMES[parsedBrowser] ?? parsedBrowser)
      : undefined;

  return {
    browser: browserName,
    browserVersion: braveVersion ?? parsed?.browser.version,
    os: osName,
    osVersion:
      osName === "Windows" ? "10/11" : parsedOs ? parsed.os.version : undefined,
    deviceType:
      parsed?.platform.type ??
      (/iPad|Tablet/i.test(userAgent)
        ? "tablet"
        : mobileHint === "?1" || /Mobi|Android|iPhone/i.test(userAgent)
          ? "mobile"
          : "desktop"),
  };
}

/**
 * Reads the two-letter country code supplied by Cloudflare. The same helper is
 * used for share views and page views so the geo aggregates agree.
 */
export function getRequestCountry(request: Request): string | undefined {
  return normalizeCountryCode(getHeader(request, "cf-ipcountry"));
}

function getReferrerDomain(referrer?: string, ownHost?: string) {
  if (!referrer) return undefined;

  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    const own = ownHost?.toLowerCase().replace(/^www\./, "");
    return host && host !== own ? host : undefined;
  } catch {
    return undefined;
  }
}

export function getUploaderInfo(request: Request): UploaderInfo {
  return {
    country: getRequestCountry(request),
    city: getHeader(request, "cf-ipcity"),
    region: getHeader(request, "cf-region"),
    timezone: getHeader(request, "cf-timezone"),
    ...parseUserAgent(
      getHeader(request, "user-agent"),
      getHeader(request, "sec-ch-ua-platform"),
      getHeader(request, "sec-ch-ua-mobile"),
    ),
    createdAt: new Date().toISOString(),
  };
}

/**
 * The share page reports the document referrer explicitly because the API
 * request itself only carries the share page as its referrer.
 */
export function getVisitorInfo(request: Request): ShareVisitor {
  const referrer =
    getHeader(request, "x-visitor-referrer") ??
    getHeader(request, "referer") ??
    getHeader(request, "referrer");
  const { browser, os } = parseUserAgent(
    getHeader(request, "user-agent"),
    getHeader(request, "sec-ch-ua-platform"),
    getHeader(request, "sec-ch-ua-mobile"),
  );

  return {
    country: getRequestCountry(request),
    city: getHeader(request, "cf-ipcity"),
    browser,
    os,
    referrer: getReferrerDomain(referrer, request.hostname),
    createdAt: new Date().toISOString(),
  };
}

function getUploaderInfoPath(shareId: string) {
  // Share IDs are validated on creation; stay defensive so a malformed ID
  // can never escape the shares directory.
  return /^[\w-]+$/.test(shareId)
    ? join(SHARE_DIRECTORY, shareId, FILE_NAME)
    : null;
}

export async function writeUploaderInfo(shareId: string, info: UploaderInfo) {
  const filePath = getUploaderInfoPath(shareId);
  if (!filePath) return;

  const tempPath = `${filePath}.${process.pid}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;

  try {
    // Do not recreate a share directory that was deleted by a removal/scan.
    await fs.access(dirname(filePath));
  } catch {
    return;
  }

  try {
    await fs.writeFile(tempPath, JSON.stringify(info), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    logger.warn(
      `Failed to write uploader information for share ${shareId}: ${error}`,
    );
  }
}

export async function readUploaderInfo(
  shareId: string,
): Promise<UploaderInfo | null> {
  const filePath = getUploaderInfoPath(shareId);
  if (!filePath) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;

  let repaired = false;
  const pick = (fields: readonly string[], source: Record<string, unknown>) =>
    Object.fromEntries(
      fields.flatMap((field) => {
        const value = source[field];
        if (typeof value !== "string") return [];
        const decoded = decodeText(value);
        if (decoded !== value) repaired = true;
        return [[field, decoded]];
      }),
    );

  // Keep only supported Cloudflare fields and repair older mojibake values.
  const info = pick(FIELDS, parsed) as unknown as UploaderInfo;
  info.createdAt = info.createdAt ?? new Date().toISOString();
  if (Array.isArray(parsed.visitors)) {
    info.visitors = parsed.visitors
      .filter(
        (visitor): visitor is Record<string, unknown> =>
          !!visitor && typeof visitor === "object" && !Array.isArray(visitor),
      )
      .map((visitor) => pick(VISITOR_FIELDS, visitor) as ShareVisitor)
      .filter((visitor) => !!visitor.createdAt)
      .slice(-MAX_VISITORS);
  }

  if (repaired) await writeUploaderInfo(shareId, info);
  return info;
}
