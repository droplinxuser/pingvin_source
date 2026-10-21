import { Logger } from "@nestjs/common";
import { Request } from "express";
import * as fs from "fs";
import * as path from "path";
import { SHARE_DIRECTORY } from "../constants";

const UPLOADER_INFO_FILE = "uploader.json";
const logger = new Logger("UploaderInfo");

export type UploaderInfo = {
  ip?: string;
  country?: string;
  city?: string;
  region?: string;
  regionCode?: string;
  continent?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  asn?: string;
  isp?: string;
  userAgent?: string;
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
  userAgent?: string,
  platform?: string,
  mobileHint?: string,
) {
  let os: string | undefined;
  let osVersion: string | undefined;
  let browser: string | undefined;
  let browserVersion: string | undefined;

  if (userAgent) {
    if (/Windows NT 10\.0/.test(userAgent)) {
      os = "Windows";
      osVersion = "10/11";
    } else if (/Windows NT ([\d.]+)/.test(userAgent)) {
      os = "Windows";
      osVersion = userAgent.match(/Windows NT ([\d.]+)/)?.[1];
    } else if (/iPhone|iPad|iPod/.test(userAgent)) {
      os = "iOS";
      osVersion = userAgent.match(/OS ([\d_]+)/)?.[1]?.replaceAll("_", ".");
    } else if (/Android[ /]([\d.]+)/.test(userAgent)) {
      os = "Android";
      osVersion = userAgent.match(/Android[ /]([\d.]+)/)?.[1];
    } else if (/Mac OS X ([\d_]+)/.test(userAgent)) {
      os = "macOS";
      osVersion = userAgent
        .match(/Mac OS X ([\d_]+)/)?.[1]
        ?.replaceAll("_", ".");
    } else if (/CrOS/.test(userAgent)) {
      os = "ChromeOS";
    } else if (/Linux/.test(userAgent)) {
      os = "Linux";
    }

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

    for (const [pattern, name] of browserRules) {
      const match = userAgent.match(pattern);
      if (match) {
        browser = name;
        browserVersion = match[1];
        break;
      }
    }
  }

  const normalizedPlatform = platform?.replaceAll('"', "").toLowerCase();
  if (!os && normalizedPlatform) {
    if (normalizedPlatform === "windows") os = "Windows";
    else if (normalizedPlatform === "macos") os = "macOS";
    else if (normalizedPlatform === "linux") os = "Linux";
    else if (normalizedPlatform === "android") os = "Android";
    else if (normalizedPlatform === "ios") os = "iOS";
    else if (normalizedPlatform === "chrome os") os = "ChromeOS";
  }

  let deviceType = "desktop";
  if (/iPad|Tablet/i.test(userAgent ?? "")) {
    deviceType = "tablet";
  } else if (
    mobileHint === "?1" ||
    /Mobi|Android|iPhone/i.test(userAgent ?? "")
  ) {
    deviceType = "mobile";
  }

  return {
    browser,
    browserVersion,
    os,
    osVersion,
    deviceType,
  };
}

export function getUploaderInfo(request: Request): UploaderInfo {
  const userAgent = getHeader(request, "user-agent");
  const forwardedFor = getHeader(request, "x-forwarded-for")?.split(",")[0];
  const platform = getHeader(request, "sec-ch-ua-platform");
  const mobileHint = getHeader(request, "sec-ch-ua-mobile");

  const country = getHeader(request, "cf-ipcountry");

  return {
    ip:
      getHeader(request, "cf-connecting-ip") ||
      forwardedFor?.trim() ||
      request.ip ||
      request.socket?.remoteAddress,
    country: country && country !== "XX" ? country.toUpperCase() : undefined,
    city: getHeader(request, "cf-ipcity"),
    region: getHeader(request, "cf-region"),
    regionCode: getHeader(request, "cf-region-code"),
    continent: getHeader(request, "cf-ipcontinent"),
    latitude: getHeader(request, "cf-iplatitude"),
    longitude: getHeader(request, "cf-iplongitude"),
    timezone: getHeader(request, "cf-timezone"),
    asn: getHeader(request, "cf-asn"),
    isp: getHeader(request, "cf-asorganization"),
    userAgent,
    ...parseUserAgent(userAgent, platform, mobileHint),
    createdAt: new Date().toISOString(),
  };
}

function getUploaderInfoPath(shareId: string) {
  // Share IDs are validated when shares are created, but keep this helper
  // defensive so a malformed ID can never escape the shares directory.
  if (!/^[a-zA-Z0-9_-]+$/.test(shareId)) return null;
  return path.join(SHARE_DIRECTORY, shareId, UPLOADER_INFO_FILE);
}

export async function writeUploaderInfo(shareId: string, info: UploaderInfo) {
  const filePath = getUploaderInfoPath(shareId);
  if (!filePath) return;

  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(info, null, 2), {
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
    const parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as UploaderInfo;
  } catch {
    return null;
  }
}
