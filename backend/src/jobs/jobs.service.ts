import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Dirent } from "fs";
import * as fs from "fs";
import * as moment from "moment";
import { FileService } from "src/file/file.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import { ConfigService } from "src/config/config.service";
import { SHARE_DIRECTORY } from "../constants";

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private cleaningExpiredShares = false;

  constructor(
    private prisma: PrismaService,
    private reverseShareService: ReverseShareService,
    private fileService: FileService,
    private configServer: ConfigService,
  ) {}

  @Cron("* * * * *")
  async deleteExpiredShares() {
    // A large expired backlog can take longer than the one-minute interval.
    // Skip the next tick instead of running two deletes over the same rows.
    if (this.cleaningExpiredShares) return;
    this.cleaningExpiredShares = true;
    try {
      await this.deleteExpiredSharesNow();
    } finally {
      this.cleaningExpiredShares = false;
    }
  }

  private async deleteExpiredSharesNow() {
    const fileRetentionPeriod = this.configServer.get(
      "share.fileRetentionPeriod",
    );

    if (fileRetentionPeriod.value === -1) {
      return;
    }

    const thresholdDate = moment()
      .subtract(fileRetentionPeriod.value, fileRetentionPeriod.unit)
      .toDate();

    const expiredShares = await this.prisma.share.findMany({
      where: {
        // We want to remove only shares that have an expiration date + retention period less than the current date, but not 0
        AND: [
          { expiration: { lt: thresholdDate } },
          { expiration: { not: moment(0).toDate() } },
        ],
      },
      select: { id: true },
    });

    for (const expiredShare of expiredShares) {
      await this.fileService.deleteAllFiles(expiredShare.id);
      await this.prisma.share.delete({
        where: { id: expiredShare.id },
      });
    }

    if (expiredShares.length > 0) {
      this.logger.log(`Deleted ${expiredShares.length} expired shares`);
    }
  }

  @Cron("0 * * * *")
  async deleteExpiredReverseShares() {
    const expiredReverseShares = await this.prisma.reverseShare.findMany({
      where: {
        shareExpiration: { lt: new Date() },
      },
      select: { id: true },
    });

    for (const expiredReverseShare of expiredReverseShares) {
      await this.reverseShareService.remove(expiredReverseShare.id);
    }

    if (expiredReverseShares.length > 0) {
      this.logger.log(
        `Deleted ${expiredReverseShares.length} expired reverse shares`,
      );
    }
  }

  @Cron("0 */6 * * *")
  async deleteUnfinishedShares() {
    const cutoff = moment().subtract(1, "day").toDate();
    const unfinishedShares = await this.prisma.share.findMany({
      where: {
        uploadLocked: false,
        OR: [
          { updatedAt: { lt: cutoff } },
          { updatedAt: { equals: null }, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
    });

    for (const unfinishedShare of unfinishedShares) {
      await this.fileService.deleteAllFiles(unfinishedShare.id);
      await this.prisma.share.delete({
        where: { id: unfinishedShare.id },
      });
    }

    if (unfinishedShares.length > 0) {
      this.logger.log(`Deleted ${unfinishedShares.length} unfinished shares`);
    }
  }

  @Cron("0 0 * * *")
  async deleteTemporaryFiles() {
    let filesDeleted = 0;

    let shareDirectories: Dirent[];
    try {
      shareDirectories = await fs.promises.readdir(SHARE_DIRECTORY, {
        withFileTypes: true,
      });
    } catch (error) {
      // A fresh data directory has no shares yet; do not log an ENOENT.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.logger.warn(`Could not scan temporary files: ${error}`);
      return;
    }

    for (const share of shareDirectories) {
      if (!share.isDirectory()) continue;
      const directory = `${SHARE_DIRECTORY}/${share.name}`;
      let temporaryFiles: string[];
      try {
        temporaryFiles = (await fs.promises.readdir(directory)).filter((file) =>
          /\.(tmp-chunk|remote|media|tmp)$/.test(file),
        );
      } catch (error) {
        // The share can be deleted while this loop is running.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.logger.warn(`Could not scan ${directory}: ${error}`);
        continue;
      }

      for (const file of temporaryFiles) {
        const filePath = `${directory}/${file}`;
        let stats: Awaited<ReturnType<typeof fs.promises.stat>>;
        try {
          stats = await fs.promises.stat(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            this.logger.warn(`Could not stat ${filePath}: ${error}`);
          continue;
        }

        const isOlderThanOneDay = moment(stats.mtime)
          .add(1, "day")
          .isBefore(moment());

        if (isOlderThanOneDay) {
          await fs.promises.rm(filePath, { recursive: true, force: true });
          // A partially uploaded chunk reserved in-flight bytes; return them
          // to the share/user quota as soon as its temp file is gone.
          if (stats.isFile())
            this.fileService.releaseTempBytes(share.name, stats.size);
          filesDeleted++;
        }
      }
    }

    this.logger.log(`Deleted ${filesDeleted} temporary files`);
  }

  @Cron("0 3 * * *")
  async deleteExpiredShareThumbnails() {
    await this.fileService.cleanupShareThumbnails();
  }

  @Cron("1 * * * *")
  async deleteExpiredTokens() {
    const { count: refreshTokenCount } =
      await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

    const { count: loginTokenCount } = await this.prisma.loginToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const { count: resetPasswordTokenCount } =
      await this.prisma.resetPasswordToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

    const deletedTokensCount =
      refreshTokenCount + loginTokenCount + resetPasswordTokenCount;

    if (deletedTokensCount > 0) {
      this.logger.log(`Deleted ${deletedTokensCount} expired refresh tokens`);
    }
  }

  @Cron("0 * * * *")
  async deleteUnactivatedUsers() {
    const cutoff = moment().subtract(24, "hours").toDate();
    const unactivatedUsers = await this.prisma.user.findMany({
      where: {
        isActivated: false,
        createdAt: { lt: cutoff },
        OR: [
          { activationTokenExpiresAt: { lt: new Date() } },
          { activationTokenExpiresAt: null },
        ],
      },
      select: {
        id: true,
        shares: { select: { id: true } },
        // Uploads through the user's reverse shares have no creatorId, so they
        // are not in `shares`; deleting the account still has to remove their
        // bytes instead of orphaning them on disk/S3.
        reverseShares: {
          select: { shares: { select: { id: true } } },
        },
      },
    });

    for (const user of unactivatedUsers) {
      const shareIds = new Set([
        ...user.shares.map((share) => share.id),
        ...user.reverseShares.flatMap((reverseShare) =>
          reverseShare.shares.map((share) => share.id),
        ),
      ]);
      await Promise.all(
        [...shareIds].map((shareId) =>
          this.fileService.deleteAllFiles(shareId),
        ),
      );
      await this.prisma.user.delete({ where: { id: user.id } });
    }

    if (unactivatedUsers.length > 0) {
      this.logger.log(`Deleted ${unactivatedUsers.length} unactivated users`);
    }
  }
}
