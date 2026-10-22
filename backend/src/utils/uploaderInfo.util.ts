import { ForbiddenException, Logger } from "@nestjs/common";
import { Request } from "express";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { SHARE_DIRECTORY } from "../constants";

const FILE_NAME = "uploader.json";
const MAX_VISITORS = 20;
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
const shareFileLocks = new Map<string, Promise<void>>();

export type ShareVisitor = Partial<
  Record<(typeof VISITOR_FIELDS)[number], string>
> & {
  createdAt: string;
};

export type UploaderInfo = Partial<Record<(typeof FIELDS)[number], string>> & {
  createdAt: string;
  views?: number;
  visitors?: ShareVisitor[];
};

type Rule = [RegExp, string, string?];

const OS_RULES: Rule[] = [
  [/Windows NT 10\.0/, "Windows", "10/11"],
  [/Windows NT ([\d.]+)/, "Windows"],
  [/(?:iPhone|iPad|iPod).*OS ([\d_]+)/, "iOS"],
  [/Android[ /]([\d.]+)/, "Android"],
  [/Mac OS X ([\d_]+)/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

const BROWSER_RULES: Rule[] = [
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
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(value, "latin1"),
      );
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

function matchRule(userAgent: string, rules: Rule[]) {
  for (const [pattern, name, fixedVersion] of rules) {
    const match = userAgent.match(pattern);
    if (match) {
      return {
        name,
        version: fixedVersion ?? match[1]?.replaceAll("_", "."),
      };
    }
  }
}

function parseUserAgent(
  userAgent = "",
  platform?: string,
  mobileHint?: string,
) {
  const os = matchRule(userAgent, OS_RULES);
  const browser = matchRule(userAgent, BROWSER_RULES);
  const platformName = platform?.replaceAll('"', "").toLowerCase();
  const finalOs = os?.name ?? PLATFORM_NAMES[platformName ?? ""];

  return {
    browser: browser?.name,
    browserVersion: browser?.version,
    os: finalOs,
    osVersion: os && finalOs === os.name ? os.version : undefined,
    deviceType: /iPad|Tablet/i.test(userAgent)
      ? "tablet"
      : mobileHint === "?1" || /Mobi|Android|iPhone/i.test(userAgent)
        ? "mobile"
        : "desktop",
  };
}

function normalizeCountry(country?: string) {
  const normalized = country?.trim().toUpperCase();
  return normalized && normalized !== "XX" ? normalized : undefined;
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
    country: normalizeCountry(getHeader(request, "cf-ipcountry")),
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
    country: normalizeCountry(getHeader(request, "cf-ipcountry")),
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

function withShareFileLock<T>(
  shareId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = shareFileLocks.get(shareId) ?? Promise.resolve();
  const result = previous.then(task);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );

  shareFileLocks.set(shareId, tail);
  void tail.then(() => {
    if (shareFileLocks.get(shareId) === tail) shareFileLocks.delete(shareId);
  });

  return result;
}

export async function writeUploaderInfo(shareId: string, info: UploaderInfo) {
  const filePath = getUploaderInfoPath(shareId);
  if (!filePath) return;

  const tempPath = `${filePath}.${process.pid}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;

  try {
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(info), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600);
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

  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;

    let repaired = false;
    const decode = (value: string) => {
      const decoded = decodeText(value);
      if (decoded !== value) repaired = true;
      return decoded;
    };
    const getText = (field: string) => {
      const value = parsed[field];
      return typeof value === "string" ? decode(value) : undefined;
    };
    const readVisitor = (value: unknown): ShareVisitor | null => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;

      const record = value as Record<string, unknown>;
      const visitor = Object.fromEntries(
        VISITOR_FIELDS.flatMap((field) => {
          const text = record[field];
          return typeof text === "string" ? [[field, decode(text)]] : [];
        }),
      ) as ShareVisitor;

      return visitor.createdAt ? visitor : null;
    };

    // Keep only supported Cloudflare fields and repair older mojibake values.
    const info = Object.fromEntries(
      FIELDS.flatMap((field) => {
        const value = getText(field);
        return value !== undefined ? [[field, value]] : [];
      }),
    ) as unknown as UploaderInfo;

    info.createdAt = info.createdAt ?? new Date().toISOString();
    if (
      typeof parsed.views === "number" &&
      Number.isFinite(parsed.views) &&
      parsed.views >= 0
    ) {
      info.views = Math.floor(parsed.views);
    }
    if (Array.isArray(parsed.visitors)) {
      info.visitors = parsed.visitors
        .map(readVisitor)
        .filter((visitor): visitor is ShareVisitor => visitor !== null)
        .slice(-MAX_VISITORS);
    }

    if (repaired) await writeUploaderInfo(shareId, info);
    return info;
  } catch {
    return null;
  }
}

export async function readShareViews(shareId: string, fallback = 0) {
  const info = await readUploaderInfo(shareId);
  return Math.max(info?.views ?? 0, fallback);
}

export async function recordShareView(
  shareId: string,
  request: Request,
  options: {
    seedViews?: number;
    maxViews?: number;
    maxViewsMessage?: string;
  } = {},
): Promise<UploaderInfo> {
  return withShareFileLock(shareId, async () => {
    const info = (await readUploaderInfo(shareId)) ?? {
      createdAt: new Date().toISOString(),
    };
    const views = Math.max(info.views ?? 0, options.seedViews ?? 0);

    if (options.maxViews != null && views >= options.maxViews) {
      throw new ForbiddenException(
        options.maxViewsMessage ??
          "The maximum number of views for this share has been exceeded.",
        "share_max_views_exceeded",
      );
    }

    info.views = views + 1;
    info.visitors = [...(info.visitors ?? []), getVisitorInfo(request)].slice(
      -MAX_VISITORS,
    );
    await writeUploaderInfo(shareId, info);

    return info;
  });
}
