import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
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

  constructor(
    private prisma: PrismaService,
    private reverseShareService: ReverseShareService,
    private fileService: FileService,
    private configServer: ConfigService,
  ) {}

  @Cron("* * * * *")
  async deleteExpiredShares() {
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
  deleteTemporaryFiles() {
    let filesDeleted = 0;

    let shareDirectories: string[];
    try {
      shareDirectories = fs
        .readdirSync(SHARE_DIRECTORY, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
    } catch (error) {
      // A fresh data directory has no shares yet; do not log an ENOENT.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.logger.warn(`Could not scan temporary files: ${error}`);
      return;
    }

    for (const shareDirectory of shareDirectories) {
      const directory = `${SHARE_DIRECTORY}/${shareDirectory}`;
      let temporaryFiles: string[];
      try {
        temporaryFiles = fs
          .readdirSync(directory)
          .filter((file) => file.endsWith(".tmp-chunk"));
      } catch (error) {
        // The share can be deleted while this loop is running.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.logger.warn(`Could not scan ${directory}: ${error}`);
        continue;
      }

      for (const file of temporaryFiles) {
        const filePath = `${directory}/${file}`;
        let stats: fs.Stats;
        try {
          stats = fs.statSync(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            this.logger.warn(`Could not stat ${filePath}: ${error}`);
          continue;
        }

        const isOlderThanOneDay = moment(stats.mtime)
          .add(1, "day")
          .isBefore(moment());

        if (isOlderThanOneDay) {
          fs.rmSync(filePath, { force: true });
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
      },
    });

    for (const user of unactivatedUsers) {
      await Promise.all(
        user.shares.map((share) => this.fileService.deleteAllFiles(share.id)),
      );
      await this.prisma.user.delete({ where: { id: user.id } });
    }

    if (unactivatedUsers.length > 0) {
      this.logger.log(`Deleted ${unactivatedUsers.length} unactivated users`);
    }
  }
}
