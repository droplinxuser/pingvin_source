import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import * as NodeClam from "clamscan";
import * as fs from "fs";
import { Readable } from "stream";
import { FileService } from "src/file/file.service";
import { PrismaService } from "src/prisma/prisma.service";
import { invalidateShareDataCache } from "src/utils/cache.util";
import { CLAMAV_HOST, CLAMAV_PORT, SHARE_DIRECTORY } from "../constants";

const clamscanConfig = {
  clamdscan: {
    host: CLAMAV_HOST,
    port: CLAMAV_PORT,
    localFallback: false,
  },
  preference: "clamdscan",
};
@Injectable()
export class ClamScanService {
  private readonly logger = new Logger(ClamScanService.name);

  constructor(
    private fileService: FileService,
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  private clamScanInstance: NodeClam | null = null;

  private async getClamScan(): Promise<NodeClam | null> {
    if (this.clamScanInstance) {
      return this.clamScanInstance;
    }

    try {
      const instance = await new NodeClam().init(clamscanConfig);
      this.logger.log("ClamAV is active and connected");
      this.clamScanInstance = instance;
      return instance;
    } catch (_) {
      this.logger.log("ClamAV is not active or unreachable");
      return null;
    }
  }

  async check(shareId: string) {
    const clamScan = await this.getClamScan();

    if (!clamScan) {
      return [];
    }

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { storageProvider: true },
    });

    const storageProvider = share?.storageProvider || "LOCAL";
    const infectedFiles = [];

    if (storageProvider === "S3") {
      const files = await this.prisma.file.findMany({
        where: { shareId },
        select: { id: true, name: true },
      });

      for (const f of files) {
        try {
          const fileObj = await this.fileService.get(shareId, f.id);
          const result = await clamScan.scanStream(fileObj.file as Readable);
          const isInfected = !!result?.isInfected;

          if (isInfected) infectedFiles.push({ id: f.id, name: f.name });
        } catch (err: any) {
          this.logger.warn(
            `ClamAV scan failed for S3 file ${f.name} (${f.id}) in share ${shareId}: ${err?.message || "unknown error"}`,
          );
        }
      }

      this.logger.log(
        `ClamAV scan completed for S3 share ${shareId}: ${infectedFiles.length} infected file(s) found`,
      );
      return infectedFiles;
    }

    // Local Storage Provider
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(`${SHARE_DIRECTORY}/${shareId}`)
        .filter((file) => file != "archive.zip");
    } catch (e) {
      void e;
      return [];
    }

    for (const fileId of files) {
      try {
        const filePath = `${SHARE_DIRECTORY}/${shareId}/${fileId}`;
        const readStream = fs.createReadStream(filePath);
        const result = await clamScan.scanStream(readStream);
        const isInfected = !!result?.isInfected;

        const fileName =
          (await this.prisma.file.findUnique({ where: { id: fileId } }))
            ?.name || fileId;

        if (isInfected) {
          infectedFiles.push({ id: fileId, name: fileName });
        }
      } catch (err: any) {
        this.logger.warn(
          `ClamAV scan failed for local file ${fileId} in share ${shareId}: ${err?.message || "unknown error"}`,
        );
      }
    }

    this.logger.log(
      `ClamAV scan completed for local share ${shareId}: ${infectedFiles.length} infected file(s) found`,
    );
    return infectedFiles;
  }

  async checkAndRemove(shareId: string) {
    try {
      const infectedFiles = await this.check(shareId);

      if (infectedFiles.length > 0) {
        const fileNames = infectedFiles.map((file) => file.name).join(", ");

        try {
          await this.removeMaliciousShare(shareId, fileNames);
        } catch (err: any) {
          this.logger.error(
            `Failed to delete malicious share ${shareId}: ${err?.message || "unknown error"}`,
          );
          return;
        }

        this.logger.warn(
          `Share ${shareId} deleted because it contained ${infectedFiles.length} malicious file(s)`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Error during ClamAV scan for share ${shareId}: ${err?.message || "unknown error"}`,
      );
    }
  }

  /**
   * ClamAV continues to remove the whole share when any file is infected.
   */
  async removeMaliciousShare(shareId: string, fileNames: string) {
    await this.fileService.deleteAllFiles(shareId);
    await this.prisma.file.deleteMany({ where: { shareId } });
    await this.prisma.share.update({
      where: { id: shareId },
      data: {
        removedReason: `Your share got removed because the file(s) ${fileNames} are malicious.`,
      },
    });
    await invalidateShareDataCache(this.cache, shareId);
  }

  /**
   * Removes one malicious file from a share. Clean files stay available. If
   * the share becomes empty it is marked removed; otherwise its ZIP is
   * invalidated so the next request rebuilds it from the remaining files.
   */
  async removeMaliciousFile(
    shareId: string,
    fileId: string,
    fileName: string,
    removedReason?: string,
  ): Promise<number> {
    const storageProvider = await this.fileService.getStorageProvider(shareId);
    await this.fileService.remove(shareId, fileId);

    if (storageProvider !== "S3") {
      await fs.promises
        .rm(`${SHARE_DIRECTORY}/${shareId}/archive.zip`, { force: true })
        .catch((error) => {
          this.logger.warn(
            `Could not delete stale ZIP for share ${shareId}: ${error instanceof Error ? error.message : error}`,
          );
        });
    }

    const remainingFiles = await this.prisma.file.count({
      where: { shareId },
    });

    if (remainingFiles === 0) {
      await this.fileService.deleteAllFiles(shareId);
      await this.prisma.share.update({
        where: { id: shareId },
        data: {
          isZipReady: false,
          removedReason:
            removedReason ??
            `Your share got removed because the file(s) ${fileName} are malicious.`,
        },
      });
    } else {
      await this.prisma.share.update({
        where: { id: shareId },
        data: { isZipReady: false },
      });
    }

    await invalidateShareDataCache(this.cache, shareId);
    return remainingFiles;
  }
}
