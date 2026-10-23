import { Injectable, Logger } from "@nestjs/common";
import checkDiskSpace from "check-disk-space";
import { DATA_DIRECTORY } from "src/constants";
import { MetricsService, PageViewMetrics } from "src/cache/metrics.service";
import { PrismaService } from "src/prisma/prisma.service";
import { SystemInfoDTO } from "./dto/systemInfo.dto";
import { ConfigService } from "src/config/config.service";
import * as path from "path";

const SYSTEM_STATS_CACHE_TTL = 60 * 1000;

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
