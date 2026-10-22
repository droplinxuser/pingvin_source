import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import checkDiskSpace from "check-disk-space";
import { DATA_DIRECTORY } from "src/constants";
import { PrismaService } from "src/prisma/prisma.service";
import { SystemInfoDTO } from "./dto/systemInfo.dto";
import { ConfigService } from "src/config/config.service";
import * as path from "path";

const SYSTEM_STATS_CACHE_KEY = "system:stats";
const SYSTEM_STATS_CACHE_TTL = 60 * 1000;

export type SystemStats = {
  userCount: number;
  shareCount: number;
  fileCount: number;
  storageSizeBytes: number;
};

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getSystemStats(): Promise<SystemStats> {
    const cached = await this.cache.get<SystemStats>(SYSTEM_STATS_CACHE_KEY);
    if (cached) return cached;

    const [userCount, shareCount, fileCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.share.count(),
      this.prisma.file.count(),
    ]);

    const sizeRows = await this.prisma.$queryRaw<{ total: number | bigint }[]>`
      SELECT COALESCE(SUM(CAST(size AS INTEGER)), 0) AS total FROM "File"
    `;

    const stats: SystemStats = {
      userCount,
      shareCount,
      fileCount,
      storageSizeBytes: Number(sizeRows[0]?.total ?? 0),
    };

    await this.cache.set(SYSTEM_STATS_CACHE_KEY, stats, SYSTEM_STATS_CACHE_TTL);
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
