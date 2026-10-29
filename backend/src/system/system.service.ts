import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import checkDiskSpace from "check-disk-space";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { Request } from "express";
import * as path from "path";
import { CLAMAV_HOST, CLAMAV_PORT, DATA_DIRECTORY } from "src/constants";
import { MetricsService, PageViewMetrics, ReferrerPage } from "src/cache/metrics.service";
import {
  ValkeyMetrics,
  emptyValkeyMetrics,
  parseValkeyInfo,
} from "src/cache/valkeyMetrics.util";
import { ValkeyService } from "src/cache/valkey.service";
import { PrismaService } from "src/prisma/prisma.service";
import { publicShareWhere } from "src/share/share.util";
import { SystemInfoDTO } from "./dto/systemInfo.dto";
import { ConfigService } from "src/config/config.service";
import {
  DependencyCheck,
  checkBinary,
  checkTcp,
  getFfmpegCandidates,
} from "src/utils/dependencies.util";
import {
  DatabaseMetrics,
  buildDatabaseMetrics,
  emptyDatabaseMetrics,
} from "src/utils/sqlite.util";

const SYSTEM_STATS_CACHE_TTL = 60 * 1000;
const SITEMAP_REFRESH_MS = 10 * 60 * 1000;
const SITEMAP_MAX_ENTRIES = 50_000;
const SITEMAP_QUERY_BATCH = 10_000;
// Keep chunk files that are no longer in the current manifest for a day so a
// CDN-cached index that still points at them does not 404.
const SITEMAP_STALE_FILE_MS = 24 * 60 * 60 * 1000;
const SITEMAP_ROOT = path.join(DATA_DIRECTORY, "sitemaps");

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

/** `sharp` is a bundled dependency; report the native library version. */
function probeSharp(): Omit<DependencyCheck, "key" | "type"> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require("sharp") as { versions?: { sharp?: string } };
    return { available: true, version: sharp.versions?.sharp };
  } catch (error) {
    return { available: false, detail: (error as Error).message };
  }
}

/** Size of a file in bytes, or null when it does not exist. */
async function statFileSize(file: string | null): Promise<number | null> {
  if (!file) return null;
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

type BaseSystemStats = {
  userCount: number;
  shareCount: number;
  fileCount: number;
  storageSizeBytes: number;
};

export type SystemStats = BaseSystemStats & PageViewMetrics;

type SitemapFileEntry = {
  name: string;
  version: string;
  entries: number;
};

type SitemapManifest = {
  version: string;
  generatedAt: string;
  files: SitemapFileEntry[];
};

type PendingSitemapWrite = {
  tempPath: string;
  finalPath: string;
};

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  private baseStats?: { at: number; value: BaseSystemStats };
  private baseStatsPending?: Promise<BaseSystemStats>;
  private readonly sitemapBuilds = new Map<string, Promise<SitemapManifest>>();
  // The manifest is small and changes at most every SITEMAP_REFRESH_MS, so a
  // validated copy avoids reading it and stats every chunk on each robots or
  // sitemap request.
  private readonly sitemapManifests = new Map<
    string,
    { at: number; manifest: SitemapManifest }
  >();

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly valkey: ValkeyService,
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

  async getReferrers(page: number, pageSize: number): Promise<ReferrerPage> {
    return this.metrics.getReferrers(page, pageSize);
  }

  // Sitemap artifacts are written to the persistent data directory. They are
  // deliberately not kept in process memory or Valkey: a full sitemap is
  // several megabytes on a large instance, while a disk read is cheap and the
  // HTTP layer (Cloudflare/Angie) already caches the response.
  private sitemapDirectory(baseUrl: string): string {
    const siteHash = createHash("sha256")
      .update(baseUrl)
      .digest("hex")
      .slice(0, 16);
    return path.join(SITEMAP_ROOT, siteHash);
  }

  private async readSitemapManifest(
    directory: string,
  ): Promise<SitemapManifest | undefined> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
      ) as SitemapManifest;
      if (
        !parsed ||
        typeof parsed.version !== "string" ||
        typeof parsed.generatedAt !== "string" ||
        !Array.isArray(parsed.files)
      )
        return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async sitemapManifestIsFresh(
    directory: string,
    manifest: SitemapManifest,
  ): Promise<boolean> {
    if (
      Date.now() - new Date(manifest.generatedAt).getTime() >
      SITEMAP_REFRESH_MS
    )
      return false;

    try {
      await Promise.all([
        fs.access(path.join(directory, "sitemap.xml")),
        ...manifest.files.map((file) =>
          fs.access(path.join(directory, file.name)),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureSitemapFiles(baseUrl: string): Promise<SitemapManifest> {
    const directory = this.sitemapDirectory(baseUrl);
    const cached = this.sitemapManifests.get(directory);
    if (cached && Date.now() - cached.at < SITEMAP_REFRESH_MS) {
      // One cheap check keeps a manually removed artifact from being served
      // from the in-memory copy until the next refresh window.
      try {
        await fs.access(path.join(directory, "sitemap.xml"));
        return cached.manifest;
      } catch {
        this.sitemapManifests.delete(directory);
      }
    }

    const manifest = await this.readSitemapManifest(directory);
    if (manifest && (await this.sitemapManifestIsFresh(directory, manifest))) {
      this.sitemapManifests.set(directory, { at: Date.now(), manifest });
      return manifest;
    }

    const running = this.sitemapBuilds.get(directory);
    if (running) return running;

    const build = this.buildSitemapFiles(baseUrl, directory)
      .then((built) => {
        this.sitemapManifests.set(directory, {
          at: Date.now(),
          manifest: built,
        });
        return built;
      })
      .finally(() => {
        this.sitemapBuilds.delete(directory);
      });
    this.sitemapBuilds.set(directory, build);
    return build;
  }

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

  async getRobotsTxt(request: Request): Promise<string> {
    const baseUrl = this.getSeoBaseUrl(request);
    let sitemapVersion: string | undefined;
    if (baseUrl) {
      try {
        sitemapVersion = (await this.ensureSitemapFiles(baseUrl)).version;
      } catch (error) {
        this.logger.warn(`Could not prepare sitemap for robots.txt: ${error}`);
      }
    }

    const lines = [
      "User-agent: *",
      "Allow: /$",
      "Allow: /share/",
      "Allow: /trending",
      "Allow: /new-media",
      "Allow: /new-files",
      // The sitemap index and its versioned chunk files must stay crawlable
      // even though the generic /api tree and query strings are disallowed.
      "Allow: /sitemap.xml",
      "Allow: /api/system/sitemaps/",
      // Share thumbnails are the images referenced by og:image and rich
      // results. The version query is part of the cache key, so allow the
      // whole thumbnail path even though generic API and query URLs are
      // disallowed below.
      "Allow: /api/shares/*/thumbnail*",
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
    if (baseUrl)
      lines.push(
        `Sitemap: ${baseUrl}/sitemap.xml${
          sitemapVersion ? `?v=${sitemapVersion}` : ""
        }`,
        "",
      );

    return lines.join("\n");
  }

  async getSitemapXml(request: Request): Promise<string> {
    const baseUrl = this.getSeoBaseUrl(request);
    await this.ensureSitemapFiles(baseUrl);
    return await fs.readFile(
      path.join(this.sitemapDirectory(baseUrl), "sitemap.xml"),
      "utf8",
    );
  }

  async getSitemapFile(request: Request, name: string): Promise<string> {
    if (!/^sitemap-\d+\.xml$/.test(name)) throw new NotFoundException();

    const baseUrl = this.getSeoBaseUrl(request);
    const directory = this.sitemapDirectory(baseUrl);

    // A CDN-cached index may still reference a chunk from the previous
    // manifest. Those files are retained for a day, so serve any existing
    // chunk with a safe name without refreshing the whole sitemap first.
    let filePath = path.join(directory, name);
    if (!(await this.fileExists(filePath))) {
      await this.ensureSitemapFiles(baseUrl);
      filePath = path.join(this.sitemapDirectory(baseUrl), name);
      if (!(await this.fileExists(filePath))) throw new NotFoundException();
    }

    return await fs.readFile(filePath, "utf8");
  }

  private async buildSitemapFiles(
    baseUrl: string,
    directory: string,
  ): Promise<SitemapManifest> {
    const previous = await this.readSitemapManifest(directory);
    await fs.mkdir(directory, { recursive: true });

    const pending: PendingSitemapWrite[] = [];
    const files: SitemapFileEntry[] = [];
    const entries: string[] = [];
    let chunkNumber = 1;

    const versionOf = (xml: string) =>
      createHash("sha256").update(xml).digest("hex").slice(0, 16);
    const urlEntry = (loc: string, lastmod?: string) =>
      `  <url><loc>${escapeXml(loc)}</loc>${
        lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ""
      }</url>`;

    const writeChunk = async () => {
      if (entries.length === 0) return;

      const name = `sitemap-${chunkNumber}.xml`;
      const xml = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...entries,
        `</urlset>`,
        "",
      ].join("\n");
      const version = versionOf(xml);
      const finalPath = path.join(directory, name);
      const previousFile = previous?.files.find((file) => file.name === name);

      if (
        !(
          previousFile?.version === version &&
          (await this.fileExists(finalPath))
        )
      ) {
        const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tempPath, xml, { encoding: "utf8", mode: 0o644 });
        pending.push({ tempPath, finalPath });
      }

      files.push({ name, version, entries: entries.length });
      entries.length = 0;
      chunkNumber += 1;
    };

    // The home page 302s to /upload when it is disabled; only list it when it
    // is actually served so the sitemap never advertises a redirect.
    if (this.configService.get("general.showHomePage") !== false)
      entries.push(urlEntry(absoluteUrl("/", baseUrl)));
    entries.push(urlEntry(absoluteUrl("/trending", baseUrl)));
    entries.push(urlEntry(absoluteUrl("/new-media", baseUrl)));
    entries.push(urlEntry(absoluteUrl("/new-files", baseUrl)));

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
      entries.push(urlEntry(absoluteUrl("/imprint", baseUrl)));
    if (
      legalEnabled &&
      (privacyText || (privacyUrl && !/^https?:\/\//i.test(privacyUrl)))
    )
      entries.push(urlEntry(absoluteUrl("/privacy", baseUrl)));

    const where = publicShareWhere();
    let cursor: string | undefined;

    try {
      while (true) {
        const shares = await this.prisma.share.findMany({
          where,
          select: { id: true, createdAt: true },
          orderBy: { id: "asc" },
          take: SITEMAP_QUERY_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (shares.length === 0) break;

        for (const share of shares) {
          entries.push(
            urlEntry(
              absoluteUrl(`/share/${encodeURIComponent(share.id)}`, baseUrl),
              share.createdAt.toISOString(),
            ),
          );
          // Keep every sitemap file within the protocol's 50k URL limit.
          if (entries.length >= SITEMAP_MAX_ENTRIES) await writeChunk();
        }

        cursor = shares[shares.length - 1].id;
        if (shares.length < SITEMAP_QUERY_BATCH) break;
      }

      await writeChunk();

      const indexXml = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...files.map(
          (file) =>
            `  <sitemap><loc>${escapeXml(
              absoluteUrl(
                `/api/system/sitemaps/${file.name}?v=${file.version}`,
                baseUrl,
              ),
            )}</loc></sitemap>`,
        ),
        `</sitemapindex>`,
        "",
      ].join("\n");
      const version = versionOf(indexXml);
      const indexPath = path.join(directory, "sitemap.xml");

      if (
        !(previous?.version === version && (await this.fileExists(indexPath)))
      ) {
        const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tempPath, indexXml, {
          encoding: "utf8",
          mode: 0o644,
        });
        pending.push({ tempPath, finalPath: indexPath });
      }

      // Move everything into place only after every temp file was written.
      for (const write of pending)
        await fs.rename(write.tempPath, write.finalPath);

      const manifest: SitemapManifest = {
        version,
        generatedAt: new Date().toISOString(),
        files,
      };
      const manifestPath = path.join(directory, "manifest.json");
      const manifestTemp = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(manifestTemp, JSON.stringify(manifest), {
        encoding: "utf8",
        mode: 0o644,
      });
      await fs.rename(manifestTemp, manifestPath);

      // Refresh the mtime of current chunks so the 24-hour grace period for a
      // stale chunk starts when it leaves the manifest, not when it was last
      // rewritten.
      const now = new Date();
      await Promise.all(
        files.map((file) =>
          fs
            .utimes(path.join(directory, file.name), now, now)
            .catch(() => undefined),
        ),
      );

      await this.cleanSitemapDirectory(directory, files);
      return manifest;
    } catch (error) {
      await Promise.all(
        pending.map((write) => fs.rm(write.tempPath, { force: true })),
      );
      throw error;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async cleanSitemapDirectory(
    directory: string,
    files: SitemapFileEntry[],
  ) {
    const current = new Set(files.map((file) => file.name));
    try {
      const entries = await fs.readdir(directory);
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.endsWith(".tmp")) {
            await fs.rm(path.join(directory, entry), { force: true });
            return;
          }
          if (!/^sitemap-\d+\.xml$/.test(entry) || current.has(entry)) return;

          const filePath = path.join(directory, entry);
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtimeMs >= SITEMAP_STALE_FILE_MS)
            await fs.rm(filePath, { force: true });
        }),
      );
    } catch (error) {
      this.logger.warn(`Could not clean old sitemap files: ${error}`);
    }
  }

  private async getBaseSystemStats(): Promise<BaseSystemStats> {
    if (
      this.baseStats &&
      Date.now() - this.baseStats.at < SYSTEM_STATS_CACHE_TTL
    ) {
      return this.baseStats.value;
    }

    // Footer page-view beacons arrive in bursts. Reuse one in-flight count so a
    // cold cache does not queue the aggregate query once per visitor on the
    // single SQLite connection.
    if (this.baseStatsPending) return this.baseStatsPending;

    const load = this.loadBaseSystemStats();
    this.baseStatsPending = load;
    try {
      return await load;
    } finally {
      if (this.baseStatsPending === load) this.baseStatsPending = undefined;
    }
  }

  private async loadBaseSystemStats(): Promise<BaseSystemStats> {
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

  /**
   * Probes the external tools the backend shells out to, so the admin page can
   * flag anything missing after a server move. Every probe is bounded and
   * never throws; unavailable tools simply report `available: false`.
   */
  async getDependencies(): Promise<DependencyCheck[]> {
    const [ffmpeg, ytDlp, clamav, database, valkeyPong] = await Promise.all([
      this.probeFfmpeg(),
      checkBinary("yt-dlp", ["--version"]),
      checkTcp(CLAMAV_HOST, CLAMAV_PORT),
      this.probeDatabase(),
      this.valkey.configured
        ? this.valkey.run((client) => client.ping())
        : Promise.resolve(undefined),
    ]);

    const mediaImportEnabled =
      this.configService.get("share.enableMediaImport") === true;

    return [
      {
        key: "node",
        type: "required",
        available: true,
        version: process.version.replace(/^v/, ""),
      },
      { key: "sharp", type: "required", ...probeSharp() },
      { key: "ffmpeg", type: "required", ...ffmpeg },
      { key: "database", type: "required", ...database },
      {
        key: "valkey",
        type: "optional",
        enabled: this.valkey.configured,
        available: !!valkeyPong,
      },
      {
        key: "ytdlp",
        type: "optional",
        enabled: mediaImportEnabled,
        available: mediaImportEnabled && ytDlp.available,
        version: ytDlp.version,
      },
      { key: "clamav", type: "optional", enabled: true, available: clamav },
    ];
  }

  /** SQLite page/file metrics for the admin storage panel. */
  async getDatabaseMetrics(): Promise<DatabaseMetrics> {
    try {
      const list = await this.prisma.$queryRawUnsafe<
        { name?: string; file?: string }[]
      >("PRAGMA database_list");
      const file =
        (list.find((row) => row.name === "main") ?? list[0])?.file ?? null;

      const [pageSize, pageCount, freePages, journalMode, version] =
        await Promise.all([
          this.pragmaNumber("PRAGMA page_size", "page_size"),
          this.pragmaNumber("PRAGMA page_count", "page_count"),
          this.pragmaNumber("PRAGMA freelist_count", "freelist_count"),
          this.pragmaText("PRAGMA journal_mode", "journal_mode"),
          this.pragmaText("SELECT sqlite_version() AS version", "version"),
        ]);

      const [sizeBytes, walSizeBytes, shmSizeBytes] = await Promise.all([
        statFileSize(file),
        statFileSize(file ? `${file}-wal` : null),
        statFileSize(file ? `${file}-shm` : null),
      ]);

      return buildDatabaseMetrics({
        file,
        sizeBytes,
        walSizeBytes,
        shmSizeBytes,
        pageSize,
        pageCount,
        freePages,
        journalMode,
        version,
      });
    } catch (error) {
      return emptyDatabaseMetrics((error as Error).message);
    }
  }

  private async pragmaNumber(sql: string, key: string): Promise<number | null> {
    const row = await this.pragmaRow(sql);
    const value = row?.[key];
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private async pragmaText(sql: string, key: string): Promise<string | null> {
    const row = await this.pragmaRow(sql);
    const value = row?.[key];
    return value == null ? null : String(value);
  }

  private async pragmaRow(
    sql: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const rows =
        await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
      return rows?.[0];
    } catch {
      return undefined;
    }
  }

  private async probeFfmpeg(): Promise<Omit<DependencyCheck, "key" | "type">> {
    for (const candidate of getFfmpegCandidates()) {
      const probe = await checkBinary(candidate, ["-version"]);
      if (probe.available)
        return { available: true, version: probe.version, detail: candidate };
    }
    return { available: false };
  }

  private async probeDatabase(): Promise<Omit<DependencyCheck, "key" | "type">> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { available: true };
    } catch (error) {
      return { available: false, detail: (error as Error).message };
    }
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
