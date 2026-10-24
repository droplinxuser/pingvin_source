import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import checkDiskSpace from "check-disk-space";
import { createHash } from "crypto";
import { Request } from "express";
import * as path from "path";
import { DATA_DIRECTORY } from "src/constants";
import { MetricsService, PageViewMetrics } from "src/cache/metrics.service";
import {
  ValkeyMetrics,
  emptyValkeyMetrics,
  parseValkeyInfo,
} from "src/cache/valkeyMetrics.util";
import { ValkeyService } from "src/cache/valkey.service";
import { PrismaService } from "src/prisma/prisma.service";
import { getCachedValue, setCachedValue } from "src/utils/cache.util";
import { SystemInfoDTO } from "./dto/systemInfo.dto";
import { ConfigService } from "src/config/config.service";

const SYSTEM_STATS_CACHE_TTL = 60 * 1000;
const SITEMAP_CACHE_TTL_MS = 10 * 60 * 1000;
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SITEMAP_MAX_URLS = 45_000;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/"/g, "&quot;")
    .replaceAll("'", "&apos;");

const absoluteUrl = (path: string, baseUrl: string): string => {
  if (!baseUrl) return path;
  try {
    return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return path;
  }
};

type BaseSystemStats = {
  userCount: number;
  shareCount: number;
  fileCount: number;
  storageSizeBytes: number;
};

export type SystemStats = BaseSystemStats & PageViewMetrics;

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  private baseStats?: { at: number; value: BaseSystemStats };

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly valkey: ValkeyService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getSystemStats(): Promise<SystemStats> {
    const [base, pageViews] = await Promise.all([
      this.getBaseSystemStats(),
      this.metrics.getLastDay(),
    ]);
    return { ...base, ...pageViews };
  }

  async recordPageView(country?: string): Promise<SystemStats> {
    const [base, pageViews] = await Promise.all([
      this.getBaseSystemStats(),
      this.metrics.recordPageView(country),
    ]);
    return { ...base, ...pageViews };
  }

  // Generated SEO artifacts are cached in Valkey (or the in-process fallback),
  // never written to SQLite. SQLite is only read on a cache miss to discover
  // the public share IDs that belong in the sitemap.
  private getSeoBaseUrl(request: Request): string {
    const configured = (this.configService.get("general.appUrl") as string)
      ?.trim()
      .replace(/\/+$/, "");
    if (configured) return configured;

    const forwardedHost = request.headers["x-forwarded-host"];
    const host = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost || request.headers.host;
    if (!host) return "";

    const forwardedProto = request.headers["x-forwarded-proto"];
    const proto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(",")[0]?.trim() ||
        ((request.socket as { encrypted?: boolean })?.encrypted
          ? "https"
          : "http");
    return `${proto}://${host}`;
  }

  private seoCacheKey(kind: "robots" | "sitemap", baseUrl: string) {
    const siteHash = createHash("sha256")
      .update(baseUrl)
      .digest("hex")
      .slice(0, 16);
    return `seo:${kind}:${siteHash}`;
  }

  async getRobotsTxt(request: Request): Promise<string> {
    const baseUrl = this.getSeoBaseUrl(request);
    const cacheKey = this.seoCacheKey("robots", baseUrl);
    const cached = await getCachedValue<string>(this.cache, cacheKey);
    if (cached) return cached;

    const lines = [
      "User-agent: *",
      "Allow: /$",
      "Allow: /share/",
      "Allow: /trending",
      "Disallow: /admin",
      "Disallow: /account",
      "Disallow: /auth",
      "Disallow: /upload",
      "Disallow: /error",
      "Disallow: /api",
      "Disallow: /s/",
      "Disallow: /share/*/edit",
      // Query strings create duplicate share/auth variants and carry recipient
      // tokens. Canonical URLs never contain a query string.
      "Disallow: /*?",
      "",
    ];
    if (baseUrl) lines.push(`Sitemap: ${baseUrl}/sitemap.xml`, "");

    const text = lines.join("\n");
    await setCachedValue(this.cache, cacheKey, text, ROBOTS_CACHE_TTL_MS);
    return text;
  }

  async getSitemapXml(request: Request): Promise<string> {
    const baseUrl = this.getSeoBaseUrl(request);
    const cacheKey = this.seoCacheKey("sitemap", baseUrl);
    const cached = await getCachedValue<string>(this.cache, cacheKey);
    if (cached) return cached;

    const shares = await this.prisma.share.findMany({
      where: {
        uploadLocked: true,
        removedReason: null,
        files: { some: {} },
        AND: [
          {
            OR: [
              { expiration: { gt: new Date() } },
              { expiration: { equals: new Date(0) } },
            ],
          },
          {
            OR: [
              { security: null },
              {
                security: {
                  is: {
                    password: null,
                    maxViews: null,
                    restrictToRecipients: false,
                  },
                },
              },
            ],
          },
          {
            OR: [
              { reverseShare: null },
              { reverseShare: { is: { publicAccess: true } } },
            ],
          },
        ],
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SITEMAP_MAX_URLS,
    });

    const urls: { loc: string; lastmod?: string }[] = [
      { loc: absoluteUrl("/", baseUrl) },
      { loc: absoluteUrl("/trending", baseUrl) },
    ];
    const legalEnabled = this.configService.get("legal.enabled") === true;
    const imprintText = this.configService.get("legal.imprintText") as string;
    const imprintUrl = this.configService.get("legal.imprintUrl") as string;
    const privacyText = this.configService.get(
      "legal.privacyPolicyText",
    ) as string;
    const privacyUrl = this.configService.get(
      "legal.privacyPolicyUrl",
    ) as string;
    if (
      legalEnabled &&
      (imprintText || (imprintUrl && !/^https?:\/\//i.test(imprintUrl)))
    )
      urls.push({ loc: absoluteUrl("/imprint", baseUrl) });
    if (
      legalEnabled &&
      (privacyText || (privacyUrl && !/^https?:\/\//i.test(privacyUrl)))
    )
      urls.push({ loc: absoluteUrl("/privacy", baseUrl) });

    for (const share of shares) {
      if (urls.length >= SITEMAP_MAX_URLS) break;
      urls.push({
        loc: absoluteUrl(`/share/${encodeURIComponent(share.id)}`, baseUrl),
        lastmod: share.createdAt.toISOString(),
      });
    }

    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...urls.map(
        ({ loc, lastmod }) =>
          `  <url><loc>${escapeXml(loc)}</loc>${
            lastmod ? `<lastmod>${lastmod}</lastmod>` : ""
          }</url>`,
      ),
      `</urlset>`,
    ].join("\n");

    await setCachedValue(this.cache, cacheKey, xml, SITEMAP_CACHE_TTL_MS);
    return xml;
  }

  private async getBaseSystemStats(): Promise<BaseSystemStats> {
    if (
      this.baseStats &&
      Date.now() - this.baseStats.at < SYSTEM_STATS_CACHE_TTL
    ) {
      return this.baseStats.value;
    }

    // One query for every counter keeps the 60-second cache miss cheap.
    const rows = await this.prisma.$queryRaw<
      {
        userCount: number | bigint;
        shareCount: number | bigint;
        fileCount: number | bigint;
        storageSizeBytes: number | bigint;
      }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM "User") AS userCount,
        (SELECT COUNT(*) FROM "Share") AS shareCount,
        (SELECT COUNT(*) FROM "File") AS fileCount,
        (SELECT COALESCE(SUM(CAST(size AS INTEGER)), 0) FROM "File") AS storageSizeBytes
    `;
    const row = rows[0];

    const stats: BaseSystemStats = {
      userCount: Number(row?.userCount ?? 0),
      shareCount: Number(row?.shareCount ?? 0),
      fileCount: Number(row?.fileCount ?? 0),
      storageSizeBytes: Number(row?.storageSizeBytes ?? 0),
    };

    this.baseStats = { at: Date.now(), value: stats };
    return stats;
  }

  async getValkeyMetrics(): Promise<ValkeyMetrics> {
    const info = await this.valkey.run((client) => client.info());
    return info
      ? parseValkeyInfo(info)
      : emptyValkeyMetrics(this.valkey.configured);
  }

  async getSystemInfo(): Promise<SystemInfoDTO | null> {
    if (this.configService.get("s3.enabled")) {
      return null;
    }

    const resolvedPath = path.resolve(DATA_DIRECTORY, "uploads");

    try {
      const diskSpace = await checkDiskSpace(resolvedPath);
      return {
        used: diskSpace.size - diskSpace.free,
        total: diskSpace.size,
      };
    } catch (e) {
      this.logger.warn(
        `Failed to check disk space for ${resolvedPath}, falling back to root: ${e.message}`,
      );
      try {
        const diskSpace = await checkDiskSpace("/");
        return {
          used: diskSpace.size - diskSpace.free,
          total: diskSpace.size,
        };
      } catch (err) {
        this.logger.error(
          `Failed to check disk space even for root: ${err.message}`,
        );
        return null;
      }
    }
  }
}
