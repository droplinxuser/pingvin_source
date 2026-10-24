import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { Cache } from "cache-manager";
import { Prisma, Share, User, ShareSecurity } from "@prisma/client";
import * as archiver from "archiver";
import * as argon from "argon2";
import * as crypto from "crypto";
import { Request } from "express";
import * as fs from "fs";
import * as moment from "moment";
import { pipeline } from "stream/promises";
import { I18nService } from "nestjs-i18n";
import { ClamScanService } from "src/clamscan/clamscan.service";
import { ConfigService } from "src/config/config.service";
import { EmailService } from "src/email/email.service";
import { FileService } from "src/file/file.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import { SystemService } from "src/system/system.service";
import {
  SHARE_META_CACHE_TTL_MS,
  getCachedValue,
  invalidateShareMetaCache,
  setCachedValue,
  shareMetaCacheKey,
} from "src/utils/cache.util";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";
import { byteToHumanSizeString } from "src/utils/fileSize.util";
import { getUserActiveStorageUsage } from "src/utils/storageQuota.util";
import { SHARE_DIRECTORY } from "../constants";
import { CreateShareDTO } from "./dto/createShare.dto";
import { ReportShareDTO } from "./dto/reportShare.dto";
import { UpdateShareDTO } from "./dto/updateShare.dto";
import { GuardShare, ShareStateService } from "./shareState.service";
import {
  SHARE_EXPIRATION,
  isPublicShare,
  isViewLimitExceeded,
  sumFileSizes,
} from "./share.util";
import { tableOrderBy } from "src/utils/pagination.util";

type ShareSecurityFields = Pick<
  ShareSecurity,
  "password" | "maxViews" | "restrictToRecipients"
>;

const SHARE_SORT_FIELDS = {
  id: "id",
  name: "name",
  views: "views",
  expiration: "expiration",
  createdAt: "createdAt",
} as const;

// Admin/account lists only need the fields exposed by the DTOs.
const SHARE_INCLUDE = {
  files: { select: { id: true, name: true, size: true } },
  creator: {
    select: {
      id: true,
      username: true,
      displayName: true,
      shareSizeLimit: true,
    },
  },
  security: {
    select: {
      password: true,
      maxViews: true,
      restrictToRecipients: true,
    },
  },
  recipients: { select: { email: true } },
} satisfies Prisma.ShareInclude;

type ShareMetaData = {
  id: string;
  isZipReady: boolean;
};

export type ShareSeo = {
  indexable: boolean;
  id: string;
  name?: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
  fileCount?: number;
  size?: number;
  files?: { name: string }[];
};

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);
  private readonly activeZipBuilds = new Set<string>();
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private fileService: FileService,
    private emailService: EmailService,
    private config: ConfigService,
    private jwtService: JwtService,
    private reverseShareService: ReverseShareService,
    private clamScanService: ClamScanService,
    private systemService: SystemService,
    private readonly i18n: I18nService,
    private shareState: ShareStateService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async create(share: CreateShareDTO, user?: User, reverseShareToken?: string) {
    const isReverseValid = reverseShareToken
      ? await this.reverseShareService.isValid(reverseShareToken)
      : false;

    const reverseShare = isReverseValid
      ? await this.reverseShareService.getByToken(reverseShareToken)
      : null;

    const quotaOwner = reverseShare ? reverseShare.creator : user;

    if (!reverseShare && user) {
      if (user.allowShare === false) {
        throw new ForbiddenException(this.i18n.t("share.notAllowedToShare"));
      }

      if (user.maxShares != null && user.maxShares > 0) {
        const activeSharesCount = await this.prisma.share.count({
          where: {
            creatorId: user.id,
            uploadLocked: true,
            OR: [
              { expiration: { gt: new Date() } },
              { expiration: { equals: moment(0).toDate() } },
            ],
          },
        });
        if (activeSharesCount >= user.maxShares) {
          throw new BadRequestException(
            this.i18n.t("share.maxSharesExceeded", {
              args: { max: user.maxShares },
            }),
          );
        }
      }
    }

    if (share.size) {
      const systemInfo = await this.systemService.getSystemInfo();
      if (systemInfo && systemInfo.total - systemInfo.used < share.size) {
        throw new BadRequestException(this.i18n.t("share.notEnoughSpace"));
      }

      if (quotaOwner?.storageQuotaLimit) {
        const quotaLimit = parseInt(quotaOwner.storageQuotaLimit);
        const activeStorageUsage = await getUserActiveStorageUsage(
          this.prisma,
          quotaOwner.id,
        );

        const projectedUsage = activeStorageUsage + share.size;
        if (projectedUsage > quotaLimit) {
          const exceededBytes = projectedUsage - quotaLimit;
          const exceededSize = byteToHumanSizeString(exceededBytes);
          throw new BadRequestException(
            reverseShare
              ? this.i18n.t("share.reverseShareQuotaExceeded", {
                  args: { exceededSize },
                })
              : this.i18n.t("share.storageQuotaExceeded", {
                  args: { exceededSize },
                }),
          );
        }
      }
    }

    if (!(await this.isShareIdAvailable(share.id)).isAvailable)
      throw new BadRequestException(this.i18n.t("share.idInUse"));

    if (!share.security || Object.keys(share.security).length == 0)
      share.security = undefined;

    if (share.security?.restrictToRecipients && share.security?.password) {
      throw new BadRequestException(
        "Cannot set a password on a share restricted to recipients.",
      );
    }

    if (share.security?.password) {
      share.security.password = await argon.hash(share.security.password);
    }

    if (
      this.configService.get("share.enableUserRecipients") &&
      share.security?.restrictToRecipients
    ) {
      if (!share.recipients?.length) {
        throw new BadRequestException(
          "A share restricted to recipients must have at least one recipient.",
        );
      }
      // Note: we intentionally do NOT check whether the recipient emails belong
      // to registered accounts. Doing so would leak which emails have an account
      // (account enumeration). Recipients who aren't registered yet simply sign
      // up to gain access (see ShareSecurityGuard); if signups are disabled they
      // can't access it.
    }

    // Expiration is automatic and immutable: every share starts with a rolling
    // expiration of 100 days, which is extended on every visit of the share page.
    const expirationDate = parseRelativeDateToAbsolute(SHARE_EXPIRATION);

    fs.mkdirSync(`${SHARE_DIRECTORY}/${share.id}`, {
      recursive: true,
    });

    const {
      size: _size,
      security: _security,
      recipients: _recipients,
      ...shareData
    } = share;

    const shareTuple = await this.prisma.share.create({
      data: {
        ...shareData,
        expiration: expirationDate,
        creator: { connect: user ? { id: user.id } : undefined },
        security: { create: share.security },
        recipients: {
          create: share.recipients
            ? share.recipients.map((email) => ({ email }))
            : [],
        },
        storageProvider: this.configService.get("s3.enabled") ? "S3" : "LOCAL",
      },
    });

    if (reverseShare) {
      // Assign share to reverse share token
      await this.prisma.reverseShare.update({
        where: { token: reverseShareToken },
        data: {
          shares: {
            connect: { id: shareTuple.id },
          },
        },
      });
    }

    return shareTuple;
  }

  async createZip(shareId: string) {
    if (this.activeZipBuilds.has(shareId)) return;
    this.activeZipBuilds.add(shareId);

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { id: true },
    });

    if (!share) {
      this.activeZipBuilds.delete(shareId);
      return;
    }

    const sharePath = `${SHARE_DIRECTORY}/${share.id}`;
    const zipPath = `${sharePath}/archive.zip`;

    if (this.config.get("s3.enabled")) {
      await this.prisma.share
        .update({
          where: { id: shareId },
          data: { isZipReady: true },
        })
        .catch((error) => {
          this.logger.error(
            `Failed to update isZipReady for S3 share ${shareId}`,
            error,
          );
        });
      await invalidateShareMetaCache(this.cache, shareId);
      this.activeZipBuilds.delete(shareId);
      return;
    }

    try {
      const files = await this.prisma.file.findMany({ where: { shareId } });
      const archive = archiver("zip", {
        zlib: { level: this.config.get("share.zipCompressionLevel") },
      });

      archive.on("warning", (err) => archive.destroy(err));

      const writeStream = fs.createWriteStream(zipPath);

      for (const file of files) {
        archive.file(`${sharePath}/${file.id}`, {
          name: file.name,
        });
      }

      await Promise.all([pipeline(archive, writeStream), archive.finalize()]);

      await this.prisma.share.update({
        where: { id: shareId },
        data: { isZipReady: true },
      });
      await invalidateShareMetaCache(this.cache, shareId);
    } catch (error) {
      this.logger.error(`Failed to create zip for share ${shareId}`, error);
      await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    } finally {
      this.activeZipBuilds.delete(shareId);
    }
  }

  async complete(id: string, reverseShareToken?: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      include: {
        files: true,
        recipients: true,
        creator: true,
        reverseShare: { include: { creator: true } },
      },
    });

    if (share.uploadLocked)
      throw new BadRequestException(this.i18n.t("share.alreadyCompleted"));

    if (share.files.length == 0)
      throw new BadRequestException(
        this.i18n.t("share.completionRequiresFile"),
      );

    if (!share.reverseShare && share.creator) {
      if (share.creator.allowShare === false) {
        throw new ForbiddenException(this.i18n.t("share.notAllowedToShare"));
      }

      if (share.creator.maxShares != null && share.creator.maxShares > 0) {
        const activeSharesCount = await this.prisma.share.count({
          where: {
            creatorId: share.creator.id,
            uploadLocked: true,
            OR: [
              { expiration: { gt: new Date() } },
              { expiration: { equals: moment(0).toDate() } },
            ],
          },
        });
        if (activeSharesCount >= share.creator.maxShares) {
          throw new BadRequestException(
            this.i18n.t("share.maxSharesExceeded", {
              args: { max: share.creator.maxShares },
            }),
          );
        }
      }
    }

    // Create a zip of all files
    if (share.files.length > 1) void this.createZip(id);

    const recipientEmails = share.recipients.map((r) => r.email);
    const matchedUsers =
      recipientEmails.length > 0
        ? await this.prisma.user.findMany({
            where: { email: { in: recipientEmails } },
            select: {
              id: true,
              email: true,
              displayName: true,
              username: true,
            },
          })
        : [];
    const userByEmail = new Map(matchedUsers.map((u) => [u.email, u]));

    // Send email for each recipient
    for (const recipient of share.recipients) {
      const userDetails = userByEmail.get(recipient.email);

      await this.emailService.sendMailToShareRecipients(
        recipient.email,
        recipient.id,
        share.id,
        share.creator || share.reverseShare?.creator,
        share.description,
        share.expiration,
        userDetails?.displayName || userDetails?.username,
      );
    }

    // Auto-link email recipients who are registered users so the share appears in their dashboard
    if (this.configService.get("share.enableUserRecipients")) {
      for (const matchedUser of matchedUsers) {
        await this.prisma.shareUserRecipient.upsert({
          where: {
            userId_shareId: { userId: matchedUser.id, shareId: share.id },
          },
          create: { userId: matchedUser.id, shareId: share.id },
          update: {},
        });
      }
    }

    const notifyReverseShareCreator = share.reverseShare
      ? this.config.get("smtp.enabled") &&
        share.reverseShare.sendEmailNotification
      : undefined;

    if (notifyReverseShareCreator) {
      await this.emailService.sendMailToReverseShareCreator(
        share.reverseShare.creator.email,
        share.id,
        share.reverseShare.creator.displayName ||
          share.reverseShare.creator.username,
      );
    }

    // Check if any file is malicious with ClamAV
    void this.clamScanService.checkAndRemove(share.id);

    if (share.reverseShare) {
      await this.prisma.reverseShare.update({
        where: { id: share.reverseShare.id },
        data: { remainingUses: { decrement: 1 } },
      });
    }

    const updatedShare = await this.prisma.share.update({
      where: { id },
      data: { uploadLocked: true },
    });

    await this.shareState.invalidateData(id);

    return {
      ...updatedShare,
      notifyReverseShareCreator,
    };
  }

  async revertComplete(id: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      include: { reverseShare: true },
    });

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    if (share.uploadLocked && share.reverseShare) {
      await this.prisma.reverseShare.update({
        where: { id: share.reverseShare.id },
        data: { remainingUses: { increment: 1 } },
      });
    }

    const updatedShare = await this.prisma.share.update({
      where: { id },
      data: { uploadLocked: false, isZipReady: false },
    });
    await this.shareState.invalidateData(id);
    return updatedShare;
  }

  async getShares(
    take?: number,
    skip?: number,
    search?: string,
    sortBy?: string,
    sortDirection?: string,
  ) {
    const include = SHARE_INCLUDE;
    const where = this.buildSearchWhere(search);

    // Size is computed from the files, so it can't be sorted with a Prisma
    // orderBy clause. Fetch all matching shares and sort them in memory.
    if (sortBy === "size") {
      const direction = sortDirection === "asc" ? 1 : -1;
      const shares = await this.prisma.share.findMany({ where, include });
      return shares
        .map((share) => this.transformShare(share))
        .sort((a, b) => (a.size - b.size) * direction)
        .slice(skip ?? 0, (skip ?? 0) + (take ?? 20));
    }

    const shares = await this.prisma.share.findMany({
      where,
      orderBy: (sortBy === "username"
        ? { creator: { username: sortDirection === "asc" ? "asc" : "desc" } }
        : tableOrderBy(SHARE_SORT_FIELDS, sortBy, sortDirection)) ?? {
        expiration: "desc",
      },
      take,
      skip,
      include,
    });

    return shares.map((share) => this.transformShare(share));
  }

  async countShares(search?: string) {
    return await this.prisma.share.count({
      where: this.buildSearchWhere(search),
    });
  }

  private buildSearchWhere(search?: string) {
    const term = search?.trim();
    if (!term) return undefined;

    return {
      OR: [
        { id: { contains: term } },
        { name: { contains: term } },
        { description: { contains: term } },
        { creator: { username: { contains: term } } },
      ],
    };
  }

  async getSharesByUser(userId: string) {
    const shares = await this.prisma.share.findMany({
      where: {
        creator: { id: userId },
        uploadLocked: true,
        // We want to grab any shares that are not expired or have their expiration date set to "never" (unix 0)
        OR: [
          { expiration: { gt: new Date() } },
          { expiration: { equals: moment(0).toDate() } },
        ],
      },
      orderBy: {
        expiration: "desc",
      },
      include: SHARE_INCLUDE,
    });
    return shares.map((share) => this.transformShare(share));
  }

  async get(id: string): Promise<any> {
    return this.shareState.getShare(id);
  }

  async getGuardShare(id: string): Promise<GuardShare | null> {
    return this.shareState.getGuardShare(id);
  }

  async shareExists(id: string): Promise<boolean> {
    return this.shareState.shareExists(id);
  }

  async getCurrentViews(id: string): Promise<number> {
    return this.shareState.getCurrentViews(id);
  }

  async getMetaData(id: string) {
    const cacheKey = shareMetaCacheKey(id);
    const cached = await getCachedValue<ShareMetaData>(this.cache, cacheKey);
    if (cached) return cached;

    const share = await this.prisma.share.findUnique({
      where: { id },
      select: {
        id: true,
        isZipReady: true,
        uploadLocked: true,
        _count: {
          select: { files: true },
        },
      },
    });

    if (!share || !share.uploadLocked)
      throw new NotFoundException(this.i18n.t("share.notFound"));

    // The DTO only exposes these two fields; keep the cache payload minimal.
    const metaData = { id: share.id, isZipReady: share.isZipReady };
    await setCachedValue(
      this.cache,
      cacheKey,
      metaData,
      SHARE_META_CACHE_TTL_MS,
    );

    if (
      !share.isZipReady &&
      share._count.files > 1 &&
      !this.activeZipBuilds.has(id)
    ) {
      void this.createZip(id);
    }

    return metaData;
  }

  /**
   * Public metadata for search engines. Protected shares return only
   * `indexable: false` so their names, file names and descriptions stay out of
   * HTML metadata, structured data and sitemaps.
   */
  async getSeo(id: string): Promise<ShareSeo> {
    const share = await this.prisma.share.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        uploadLocked: true,
        removedReason: true,
        expiration: true,
        security: {
          select: {
            password: true,
            maxViews: true,
            restrictToRecipients: true,
          },
        },
        reverseShare: { select: { publicAccess: true } },
        files: {
          select: { name: true },
          orderBy: { name: "asc" },
          take: 20,
        },
        _count: { select: { files: true } },
      },
    });

    if (!share || share.removedReason || !share.uploadLocked)
      throw new NotFoundException(this.i18n.t("share.notFound"));

    if (
      !moment(share.expiration).isSame(0) &&
      moment().isAfter(share.expiration)
    )
      throw new NotFoundException(this.i18n.t("share.notFound"));

    if (!isPublicShare(share) || share._count.files === 0)
      return { indexable: false, id: share.id };

    const sizeRows = await this.prisma.$queryRaw<
      { size: number | bigint | null }[]
    >`
      SELECT COALESCE(SUM(CAST(size AS INTEGER)), 0) AS size
      FROM "File"
      WHERE "shareId" = ${share.id}
    `;

    return {
      indexable: true,
      id: share.id,
      name: share.name ?? undefined,
      description: share.description ?? undefined,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt ?? share.createdAt,
      fileCount: share._count.files,
      size: Number(sizeRows[0]?.size ?? 0),
      files: share.files,
    };
  }

  async report(id: string, report: ReportShareDTO) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        uploadLocked: true,
        files: { select: { name: true } },
      },
    });

    if (!share || !share.uploadLocked)
      throw new NotFoundException(this.i18n.t("share.notFound"));

    await this.emailService.sendShareReportEmail(
      share.id,
      share.name,
      share.files.map((file) => file.name),
      report.reason,
      report.message,
    );
  }

  async remove(
    shareId: string,
    isDeleterAdmin = false,
    knownShare?: Pick<Share, "creatorId">,
  ) {
    // The owner guard already loaded the share for the request.
    const share =
      knownShare ??
      (await this.prisma.share.findUnique({
        where: { id: shareId },
        select: { creatorId: true },
      }));

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    if (!share.creatorId && !isDeleterAdmin)
      throw new ForbiddenException(this.i18n.t("share.anonymousNoDelete"));

    await this.shareState.invalidateData(shareId);
    await this.fileService.deleteAllFiles(shareId);
    await this.prisma.share.delete({ where: { id: shareId } });
    // A concurrent read can repopulate the cache between the steps above.
    await this.shareState.invalidateData(shareId);
  }

  async expire(shareId: string, knownShare?: Pick<Share, "creatorId">) {
    const share =
      knownShare ??
      (await this.prisma.share.findUnique({
        where: { id: shareId },
        select: { creatorId: true },
      }));

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    if (!share.creatorId) {
      throw new ForbiddenException(this.i18n.t("share.anonymousNoExpire"));
    }

    await this.prisma.share.update({
      where: { id: shareId },
      data: { expiration: moment().toDate() },
    });
    await this.shareState.invalidateData(shareId);
  }

  async update(
    shareId: string,
    body: UpdateShareDTO,
    user?: User,
    share?: Share & { security?: ShareSecurity },
  ) {
    const currentShare =
      share ||
      (await this.prisma.share.findUnique({
        where: { id: shareId },
        include: { security: true },
      }));

    const isUpdaterAdmin = user?.isAdmin === true;
    if (!currentShare.creatorId && !isUpdaterAdmin) {
      throw new ForbiddenException(this.i18n.t("share.anonymousNoUpdate"));
    }

    // Expiration is automatic and immutable, so it can't be changed via update
    const data: Prisma.ShareUpdateInput = {
      name: body.name !== undefined ? body.name || null : undefined,
      description:
        body.description !== undefined ? body.description || null : undefined,
    };

    if (body.security) {
      await this.updateSecurity(shareId, body, currentShare.security);
    }

    // The update response already contains every relation the DTO needs, so
    // there is no follow-up read after writing (and invalidating the cache).
    const updatedShare = await this.prisma.share.update({
      where: { id: shareId },
      data,
      include: SHARE_INCLUDE,
    });
    await this.shareState.invalidateData(shareId);

    return this.transformShare(updatedShare);
  }

  private async updateSecurity(
    shareId: string,
    body: UpdateShareDTO,
    currentSecurity?: ShareSecurity,
  ) {
    const nextPassword = body.security.removePassword
      ? null
      : body.security.password
        ? await argon.hash(body.security.password)
        : currentSecurity?.password;
    const nextMaxViews =
      body.security.maxViews !== undefined
        ? body.security.maxViews
        : currentSecurity?.maxViews;

    // A recipient-restricted share keeps its security row even when it has no
    // password or view limit; deleting the row would silently lift the
    // restriction.
    if (
      !nextPassword &&
      !nextMaxViews &&
      !currentSecurity?.restrictToRecipients
    ) {
      if (currentSecurity) {
        await this.prisma.shareSecurity.delete({ where: { shareId } });
      }
      return;
    }

    await this.prisma.shareSecurity.upsert({
      where: { shareId },
      create: {
        share: { connect: { id: shareId } },
        password: nextPassword,
        maxViews: nextMaxViews,
        restrictToRecipients: currentSecurity?.restrictToRecipients ?? false,
      },
      update: {
        password: nextPassword,
        maxViews: nextMaxViews,
      },
    });
  }

  async getReceivedShares(userId: string) {
    return this.prisma.shareUserRecipient.findMany({
      where: { userId },
      select: {
        id: true,
        share: {
          select: {
            id: true,
            name: true,
            expiration: true,
            creator: {
              select: {
                username: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private transformShare(share: any) {
    return {
      ...share,
      size: sumFileSizes(share.files),
      recipients: share.recipients?.map((recipient) => recipient.email) ?? [],
      security: {
        maxViews: share.security?.maxViews,
        passwordProtected: !!share.security?.password,
        restrictToRecipients: !!share.security?.restrictToRecipients,
      },
    };
  }

  async isShareIdAvailable(id: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      select: { id: true },
    });
    return { isAvailable: !share };
  }

  async recordView(id: string, request: Request, maxViews?: number | null) {
    return this.shareState.recordView(id, request, maxViews);
  }

  assertViewLimit(
    views: number,
    maxViews?: number | null,
    allowAtLimit = false,
  ) {
    if (isViewLimitExceeded(views, maxViews, allowAtLimit)) {
      throw new ForbiddenException(
        this.i18n.t("share.maxViewsExceeded"),
        "share_max_views_exceeded",
      );
    }
  }

  async getShareToken(shareId: string, password: string) {
    const share = await this.shareState.getGuardShare(shareId);
    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    if (share?.security?.password) {
      if (!password) {
        throw new ForbiddenException(
          this.i18n.t("file.passwordProtected"),
          "share_password_required",
        );
      }

      const isPasswordValid = await argon.verify(
        share.security.password,
        password,
      );
      if (!isPasswordValid) {
        throw new ForbiddenException(
          this.i18n.t("share.wrongPassword"),
          "wrong_password",
        );
      }
    }

    if (share.security?.maxViews) {
      this.assertViewLimit(
        await this.getCurrentViews(share.id),
        share.security.maxViews,
      );
    }
    return await this.generateShareToken(share);
  }

  async generateShareToken(
    share: Share & { security?: ShareSecurityFields | null },
  ) {
    const { id: shareId, expiration, createdAt, security } = share;

    const tokenPayload = {
      shareId,
      shareCreatedAt: moment(createdAt).unix(),
      sharePasswordSignature: this.getSharePasswordSignature(
        security?.password,
      ),
      iat: moment().unix(),
    };

    const tokenOptions: JwtSignOptions = {
      secret: this.config.get("internal.jwtSecret"),
    };

    if (!moment(expiration).isSame(0)) {
      const diffSeconds = moment(expiration).diff(new Date(), "seconds");
      // Default to a 1 hour token if the share is expired but being viewed by an admin
      tokenOptions.expiresIn = diffSeconds > 0 ? diffSeconds : 3600;
    }

    return this.jwtService.sign(tokenPayload, tokenOptions);
  }

  async verifyShareToken(
    share: Share & { security?: ShareSecurityFields | null },
    token: string,
  ) {
    const { expiration, createdAt, security } = share;

    try {
      const claims = this.jwtService.verify(token, {
        secret: this.config.get("internal.jwtSecret"),
        // Ignore expiration if expiration is 0
        ignoreExpiration: moment(expiration).isSame(0),
      });

      return (
        claims.shareId == share.id &&
        claims.shareCreatedAt == moment(createdAt).unix() &&
        (!security?.password ||
          claims.sharePasswordSignature ===
            this.getSharePasswordSignature(security.password))
      );
    } catch {
      return false;
    }
  }

  private getSharePasswordSignature(password?: string) {
    if (!password) return undefined;

    return crypto
      .createHmac("sha512", this.config.get("internal.jwtSecret"))
      .update(password)
      .digest("hex");
  }
}
