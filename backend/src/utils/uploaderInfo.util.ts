import { Logger } from "@nestjs/common";
import { Request } from "express";
import * as fs from "fs";
import * as path from "path";
import { SHARE_DIRECTORY } from "../constants";

const UPLOADER_INFO_FILE = "uploader.json";
const LEGACY_PRIVATE_FIELDS = ["ip", "latitude", "longitude", "userAgent"];
const logger = new Logger("UploaderInfo");

export type UploaderInfo = {
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
  asn?: string;
  isp?: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
  createdAt: string;
};

function getHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) return undefined;
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

function parseUserAgent(
  userAgent = "",
  platform?: string,
  mobileHint?: string,
) {
  const osRules: Array<
    [RegExp, string, (match: RegExpMatchArray) => string | undefined]
  > = [
    [/Windows NT 10\.0/, "Windows", () => "10/11"],
    [/Windows NT ([\d.]+)/, "Windows", (match) => match[1]],
    [
      /iPhone|iPad|iPod.*OS ([\d_]+)/,
      "iOS",
      (match) => match[1].replaceAll("_", "."),
    ],
    [/Android[ /]([\d.]+)/, "Android", (match) => match[1]],
    [
      /Mac OS X ([\d_]+)/,
      "macOS",
      (match) => match[1].replaceAll("_", "."),
    ],
    [/CrOS/, "ChromeOS", () => undefined],
    [/Linux/, "Linux", () => undefined],
  ];
  const osRule = osRules.find(([pattern]) => pattern.test(userAgent));
  const os = osRule?.[1];
  const osVersion = osRule?.[2](userAgent.match(osRule[0])!);

  const browserRules: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/Brave\/([\d.]+)/, "Brave"],
    [/CriOS\/([\d.]+)/, "Chrome"],
    [/FxiOS\/([\d.]+)/, "Firefox"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
    [/Safari\/([\d.]+)/, "Safari"],
  ];
  const browserRule = browserRules.find(([pattern]) => pattern.test(userAgent));
  const browser = browserRule?.[1];
  const browserVersion = browserRule
    ? userAgent.match(browserRule[0])?.[1]
    : undefined;

  const platformOs: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    android: "Android",
    ios: "iOS",
    "chrome os": "ChromeOS",
  };
  const platformName = platform?.replaceAll('"', "").toLowerCase();
  const finalOs = os ?? (platformName ? platformOs[platformName] : undefined);

  const deviceType = /iPad|Tablet/i.test(userAgent)
    ? "tablet"
    : mobileHint === "?1" || /Mobi|Android|iPhone/i.test(userAgent)
      ? "mobile"
      : "desktop";

  return {
    browser,
    browserVersion,
    os: finalOs,
    osVersion: finalOs === os ? osVersion : undefined,
    deviceType,
  };
}

export function getUploaderInfo(request: Request): UploaderInfo {
  const country = getHeader(request, "cf-ipcountry");

  return {
    country: country && country !== "XX" ? country.toUpperCase() : undefined,
    city: getHeader(request, "cf-ipcity"),
    region: getHeader(request, "cf-region"),
    timezone: getHeader(request, "cf-timezone"),
    asn: getHeader(request, "cf-asn"),
    isp: getHeader(request, "cf-asorganization"),
    ...parseUserAgent(
      getHeader(request, "user-agent"),
      getHeader(request, "sec-ch-ua-platform"),
      getHeader(request, "sec-ch-ua-mobile"),
    ),
    createdAt: new Date().toISOString(),
  };
}

function getUploaderInfoPath(shareId: string) {
  // Share IDs are validated on creation; keep this defensive so a malformed
  // ID can never escape the shares directory.
  if (!/^[a-zA-Z0-9_-]+$/.test(shareId)) return null;
  return path.join(SHARE_DIRECTORY, shareId, UPLOADER_INFO_FILE);
}

export async function writeUploaderInfo(shareId: string, info: UploaderInfo) {
  const filePath = getUploaderInfoPath(shareId);
  if (!filePath) return;

  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(info), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
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

  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(filePath, "utf8"),
    ) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;

    // Older files may still contain private fields; never expose them.
    for (const field of LEGACY_PRIVATE_FIELDS) delete parsed[field];

    return parsed as UploaderInfo;
  } catch {
    return null;
  }
}
