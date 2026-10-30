import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Cache } from "cache-manager";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { Prisma, Share, User, ShareSecurity } from "@prisma/client";
import * as argon from "argon2";
import * as crypto from "crypto";
import { Request } from "express";
import * as fs from "fs";
import * as moment from "moment";
import { I18nService } from "nestjs-i18n";
import { ClamScanService } from "src/clamscan/clamscan.service";
import { ConfigService } from "src/config/config.service";
import { EmailService } from "src/email/email.service";
import { FileService } from "src/file/file.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import { SystemService } from "src/system/system.service";
import { VirusTotalService } from "src/virustotal/virustotal.service";
import { byteToHumanSizeString } from "src/utils/fileSize.util";
import { getUserActiveStorageUsage } from "src/utils/storageQuota.util";
import {
  getCachedValue,
  getShareCacheEpoch,
  setCachedValueIfCurrent,
  shareSeoCacheKey,
} from "src/utils/cache.util";
import { SHARE_DIRECTORY } from "../constants";
import { findPreview } from "./preview.util";
import { CreateShareDTO } from "./dto/createShare.dto";
import { ReportShareDTO } from "./dto/reportShare.dto";
import { UpdateShareDTO } from "./dto/updateShare.dto";
import { GuardShare, ShareStateService } from "./shareState.service";
import {
  activeShareWhere,
  getShareExpiration,
  isPublicShare,
  isShareExpired,
  isViewLimitExceeded,
  resolveShareSizeLimit,
  shareWriteLock,
  sumFileSizes,
} from "./share.util";
import { SearchService } from "src/cache/search.service";
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
      avatarUpdatedAt: true,
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

// The admin table only exposes the derived share size, so it does not need
// file names or ids for every row in the page.
const ADMIN_SHARE_INCLUDE = {
  ...SHARE_INCLUDE,
  files: { select: { size: true } },
} satisfies Prisma.ShareInclude;

export type ShareSeo = {
  indexable: boolean;
  id: string;
  // Visibility hints let the share page render the password gate without
  // first issuing a request that is guaranteed to return 403 (which browsers
  // report as a console error).
  requiresPassword?: boolean;
  name?: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
  fileCount?: number;
  size?: number;
  files?: { id?: string; name: string; size?: string; createdAt?: Date }[];
  thumbnailUrl?: string;
};

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);
  // The share page SSR and a crawler can request the same cold SEO payload at
  // once; share the in-flight load instead of running its queries twice.
  private readonly pendingSeoLoads = new Map<string, Promise<ShareSeo>>();
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
    private virusTotalService: VirusTotalService,
    private searchService: SearchService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async create(share: CreateShareDTO, user?: User, reverseShareToken?: string) {
    const reverseShare = reverseShareToken
      ? await this.reverseShareService.getValidByToken(reverseShareToken)
      : null;

    // A stale/exhausted reverse-share cookie must not silently fall through
    // to a normal (anonymous) share, which would bypass its size/use limits.
    if (reverseShareToken && !reverseShare) {
      throw new BadRequestException(
        this.i18n.t("reverseShare.noUsesRemaining"),
      );
    }

    const quotaOwner = reverseShare ? reverseShare.creator : user;

    // Authenticated creators must obey their account limits even when they use
    // a reverse-share token. Otherwise a user at maxShares (or with sharing
    // disabled) could keep creating shares through any reverse-share link.
    if (user) {
      if (user.allowShare === false) {
        throw new ForbiddenException(this.i18n.t("share.notAllowedToShare"));
      }

      if (user.maxShares != null && user.maxShares > 0) {
        const activeSharesCount = await this.prisma.share.count({
          where: activeShareWhere(user.id),
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
    // window which is extended on every visit of the share page. Member shares
    // keep 100 days; anonymous/guest uploads expire after 10 days.
    const expirationDate = getShareExpiration(!!user);

    // Consume the reverse-share use atomically before writing anything. The
    // previous check-then-decrement-on-complete flow allowed parallel creates
    // (and the revert loop) to exceed maxUseCount.
    const reservedUse = reverseShare
      ? await this.reverseShareService.reserveUse(reverseShareToken)
      : false;
    if (reverseShare && !reservedUse) {
      throw new BadRequestException(
        this.i18n.t("reverseShare.noUsesRemaining"),
      );
    }

    const {
      size: _size,
      security: _security,
      recipients: _recipients,
      ...shareData
    } = share;
    const shareDirectory = `${SHARE_DIRECTORY}/${share.id}`;

    let shareTuple;
    try {
      // Keep the directory creation inside the guarded block: a failure here
      // must refund the reserved reverse-share use like any other create error.
      fs.mkdirSync(shareDirectory, { recursive: true });
      shareTuple = await this.prisma.share.create({
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
          storageProvider: this.configService.get("s3.enabled")
            ? "S3"
            : "LOCAL",
          // Link the reverse share in the same INSERT instead of a second
          // UPDATE; the token is unique, so the nested connect is unambiguous.
          reverseShare: reverseShare
            ? { connect: { token: reverseShareToken } }
            : undefined,
        },
      });
    } catch (error) {
      // Do not burn a use, and do not leave an unlinked share or an empty
      // directory behind, when the create/link step fails after the
      // reservation.
      if (reservedUse)
        await this.reverseShareService.refundUse(reverseShareToken);
      if (shareTuple) {
        await this.prisma.share
          .delete({ where: { id: shareTuple.id } })
          .catch(() => undefined);
      }
      // A concurrent request may have won the same share id and already be
      // uploading into this directory. Only remove it when no Share row owns
      // the id, otherwise this failed request would delete the winner's files.
      const owner = await this.prisma.share
        .findUnique({ where: { id: share.id }, select: { id: true } })
        .catch(() => undefined);
      if (!owner)
        await fs.promises
          .rm(shareDirectory, { recursive: true, force: true })
          .catch(() => undefined);
      throw error;
    }

    return shareTuple;
  }

  async complete(id: string) {
    return shareWriteLock.run(id, () => this.completeShare(id));
  }

  private async completeShare(id: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      select: {
        id: true,
        description: true,
        expiration: true,
        uploadLocked: true,
        files: { select: { id: true, name: true, size: true } },
        recipients: { select: { id: true, email: true } },
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUpdatedAt: true,
            email: true,
            allowShare: true,
            maxShares: true,
            shareSizeLimit: true,
          },
        },
        reverseShare: {
          select: {
            id: true,
            sendEmailNotification: true,
            maxShareSize: true,
            creator: {
              select: {
                id: true,
                username: true,
                displayName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    if (share.uploadLocked)
      throw new BadRequestException(this.i18n.t("share.alreadyCompleted"));

    if (share.files.length == 0)
      throw new BadRequestException(
        this.i18n.t("share.completionRequiresFile"),
      );

    // Concurrent uploads for separate files are only accounted for in the DB
    // once each one finishes. Re-check the aggregate here so a burst can never
    // publish a share above the configured share or account limit.
    const shareSize = sumFileSizes(share.files);
    const sizeLimit = resolveShareSizeLimit(
      parseInt(this.configService.get("share.maxSize")),
      share,
    );
    if (sizeLimit > 0 && shareSize > sizeLimit) {
      throw new BadRequestException(this.i18n.t("file.maxSizeExceeded"));
    }

    if (share.creator) {
      if (share.creator.allowShare === false) {
        throw new ForbiddenException(this.i18n.t("share.notAllowedToShare"));
      }

      if (share.creator.maxShares != null && share.creator.maxShares > 0) {
        const activeSharesCount = await this.prisma.share.count({
          where: activeShareWhere(share.creator.id),
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

    // ZIP archives are not built during completion. The legacy endpoint still
    // serves archives already on disk (and S3 builds on explicit request).

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

    // A large recipient list would otherwise keep the completion request open
    // for the whole SMTP round trip. Notifications are sent after the response
    // and any failure is logged instead of failing the upload.
    void this.sendRecipientEmails(share, userByEmail).catch((error) =>
      this.logger.warn(`Could not notify share recipients: ${error}`),
    );

    // Auto-link email recipients who are registered users so the share appears in their dashboard.
    if (this.configService.get("share.enableUserRecipients")) {
      const userIds = matchedUsers.map((user) => user.id);
      if (userIds.length > 0) {
        // One read plus one insert instead of a serial UPSERT per recipient;
        // with a single SQLite connection that loop dominated completion time.
        const existing = await this.prisma.shareUserRecipient.findMany({
          where: { shareId: share.id, userId: { in: userIds } },
          select: { userId: true },
        });
        const linked = new Set(existing.map((row) => row.userId));
        const missing = userIds.filter((userId) => !linked.has(userId));
        if (missing.length > 0)
          await this.prisma.shareUserRecipient.createMany({
            data: missing.map((userId) => ({ shareId: share.id, userId })),
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

    // The reverse-share use was reserved atomically in create(); completing or
    // reverting the upload must not change it again.
    const updatedShare = await this.prisma.share.update({
      where: { id },
      data: { uploadLocked: true },
    });

    await this.shareState.invalidateData(id);
    void this.searchService.invalidate();

    // Build the listing/OG thumbnail in the background. The browser may
    // request it immediately, in which case the endpoint joins this build.
    this.fileService.scheduleShareThumbnail(id);

    // Queue non-media files for the rate-limited VirusTotal background scan
    // only after the share is complete and visible.
    this.virusTotalService.scanShare(share);

    return {
      ...updatedShare,
      notifyReverseShareCreator,
    };
  }

  private async sendRecipientEmails(
    share: {
      id: string;
      description: string | null;
      expiration: Date;
      recipients: { id: string; email: string }[];
      creator: Pick<User, "email" | "displayName" | "username"> | null;
      reverseShare: {
        creator: Pick<User, "email" | "displayName" | "username">;
      } | null;
    },
    userByEmail: Map<string, Pick<User, "displayName" | "username">>,
  ) {
    if (
      !this.configService.get("share.enableShareEmailRecipients") ||
      !this.configService.get("smtp.enabled")
    )
      return;

    for (const recipient of share.recipients) {
      const userDetails = userByEmail.get(recipient.email);
      try {
        await this.emailService.sendMailToShareRecipients(
          recipient.email,
          recipient.id,
          share.id,
          share.creator ?? share.reverseShare?.creator,
          share.description,
          share.expiration,
          userDetails?.displayName || userDetails?.username,
        );
      } catch (error) {
        this.logger.warn(
          `Could not send share email to ${recipient.email}: ${error}`,
        );
      }
    }
  }

  async revertComplete(id: string) {
    return shareWriteLock.run(id, () => this.revertCompleteShare(id));
  }

  private async revertCompleteShare(id: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      select: { uploadLocked: true },
    });

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    // Never refund a reverse-share use here: reverting and re-completing the
    // same upload would otherwise restore the use indefinitely.
    const updatedShare = await this.prisma.share.update({
      where: { id },
      data: { uploadLocked: false, isZipReady: false },
    });
    await this.shareState.invalidateData(id);
    void this.searchService.invalidate();
    await this.fileService.removeShareThumbnail(id);
    await this.fileService.removeLocalZip(id);
    return updatedShare;
  }

  async getShares(
    take?: number,
    skip?: number,
    search?: string,
    sortBy?: string,
    sortDirection?: string,
  ) {
    const include = ADMIN_SHARE_INCLUDE;

    // Size is derived from the files, so it can't be sorted with a Prisma
    // orderBy clause. Order just the requested page in SQL instead of loading
    // every share and its relations into memory.
    if (sortBy === "size") {
      const term = search?.trim();
      // Match Prisma's `contains` semantics (including its LIKE wildcards) so
      // the page and the count stay consistent for every search term.
      const pattern = term ? `%${term}%` : undefined;
      const direction = Prisma.raw(sortDirection === "asc" ? "ASC" : "DESC");
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s."id"
        FROM "Share" s
        LEFT JOIN "File" f ON f."shareId" = s."id"
        LEFT JOIN "User" u ON u."id" = s."creatorId"
        ${
          pattern
            ? Prisma.sql`WHERE s."id" LIKE ${pattern}
                OR s."name" LIKE ${pattern}
                OR s."description" LIKE ${pattern}
                OR u."username" LIKE ${pattern}`
            : Prisma.empty
        }
        GROUP BY s."id"
        ORDER BY COALESCE(SUM(CAST(f."size" AS INTEGER)), 0) ${direction}
        LIMIT ${take ?? 20} OFFSET ${skip ?? 0}
      `;
      if (ids.length === 0) return [];

      const shares = await this.prisma.share.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        include,
      });
      const byId = new Map(shares.map((share) => [share.id, share]));
      return ids.flatMap(({ id }) => {
        const share = byId.get(id);
        return share ? [this.transformShare(share)] : [];
      });
    }

    const shares = await this.prisma.share.findMany({
      where: this.buildSearchWhere(search),
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
      where: activeShareWhere(userId),
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

  /**
   * Comment mutations change the version embedded in the share payload. Drop
   * the short-lived share cache so the next page load requests the new
   * comments cache key instead of a month-old edge entry.
   */
  async invalidateCommentsDataCache(id: string): Promise<void> {
    await this.shareState.invalidateCommentsData(id);
  }

  async getMetaData(id: string) {
    // ZIP archives are not built automatically. Existing archives remain
    // downloadable through the API; the flag is kept for client compatibility.
    // The security guard already loaded this share into the guard cache, so do
    // not run a second full share query just to read one flag.
    const share = await this.shareState.getGuardShare(id);
    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    return { id: share.id, isZipReady: share.isZipReady };
  }

  /**
   * Public metadata for search engines. Protected shares return only
   * `indexable: false` so their names, file names and descriptions stay out of
   * HTML metadata, structured data and sitemaps.
   */
  async getSeo(id: string): Promise<ShareSeo> {
    // The share page SSR asks for this on every uncached render. A 60-second
    // entry (matching the edge TTL) removes the share/size queries from the
    // hot path; every mutation already invalidates the share data cache.
    const cacheKey = shareSeoCacheKey(id);
    const cached = await getCachedValue<ShareSeo>(this.cache, cacheKey);
    if (cached) return cached;

    const pending = this.pendingSeoLoads.get(id);
    if (pending) return pending;

    const load = this.loadSeo(id, cacheKey);
    this.pendingSeoLoads.set(id, load);
    void load
      .finally(() => {
        if (this.pendingSeoLoads.get(id) === load)
          this.pendingSeoLoads.delete(id);
      })
      .catch(() => {});
    return load;
  }

  private async loadSeo(id: string, cacheKey: string): Promise<ShareSeo> {
    const epoch = getShareCacheEpoch(id);
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
          select: { id: true, name: true, size: true, createdAt: true },
          orderBy: { name: "asc" },
          // Enough file names to find a preview and still keep the query
          // small for shares with thousands of files.
          take: 50,
        },
        _count: { select: { files: true } },
      },
    });

    if (!share || share.removedReason || !share.uploadLocked)
      throw new NotFoundException(this.i18n.t("share.notFound"));

    if (isShareExpired(share.expiration))
      throw new NotFoundException(this.i18n.t("share.notFound"));

    if (!isPublicShare(share) || share._count.files === 0)
      return {
        indexable: false,
        id: share.id,
        requiresPassword: !!share.security?.password,
      };

    // The first 50 files are already loaded. A share at or below that limit
    // has its complete file list in memory, so the SUM query is unnecessary.
    const size =
      share._count.files <= share.files.length
        ? sumFileSizes(share.files)
        : Number(
            (
              await this.prisma.$queryRaw<{ size: number | bigint | null }[]>`
                SELECT COALESCE(SUM(CAST(size AS INTEGER)), 0) AS size
                FROM "File"
                WHERE "shareId" = ${share.id}
              `
            )[0]?.size ?? 0,
          );

    // Start the background build, then expose the versioned URL once the
    // thumbnail exists. New shares are built at completion; this covers legacy
    // shares and lets the share page SSR stay fast when ffmpeg is needed.
    if (findPreview(share.files))
      this.fileService.scheduleShareThumbnail(share.id);
    const hasThumbnail = await this.fileService.hasShareThumbnail(share.id);
    const thumbnailUrl = hasThumbnail
      ? `/api/shares/${share.id}/thumbnail?v=${(
          share.updatedAt ?? share.createdAt
        ).getTime()}`
      : undefined;

    const result: ShareSeo = {
      indexable: true,
      id: share.id,
      name: share.name ?? undefined,
      description: share.description ?? undefined,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt ?? share.createdAt,
      fileCount: share._count.files,
      size,
      files: share.files,
      thumbnailUrl,
    };
    await setCachedValueIfCurrent(
      this.cache,
      cacheKey,
      result,
      60_000,
      id,
      epoch,
    );
    return result;
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
    // The share-level invalidation below covers this deletion as well.
    await this.fileService.deleteAllFiles(shareId, false);
    await this.prisma.share.delete({ where: { id: shareId } });
    // A concurrent read can repopulate the cache between the steps above.
    await this.shareState.invalidateData(shareId);
    void this.searchService.invalidate();
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
    void this.searchService.invalidate();
    await Promise.all([
      this.virusTotalService.removeJobsForShare(shareId),
      this.fileService.removeShareThumbnail(shareId),
    ]);
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
    void this.searchService.invalidate();

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
                id: true,
                username: true,
                displayName: true,
                avatarUpdatedAt: true,
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

  /**
   * Keeps only file ids that actually belong to the share. The download beacon
   * is public, so without this check any visitor could create a new Valkey hash
   * field per arbitrary id and inflate per-file counters.
   */
  async filterDownloadFileIds(
    shareId: string,
    fileIds: string[],
  ): Promise<string[]> {
    if (fileIds.length === 0) return [];
    const files = await this.prisma.file.findMany({
      where: { shareId, id: { in: fileIds } },
      select: { id: true },
    });
    return files.map((file) => file.id);
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
      // The guard cache's view count can be slightly old, but the view limit
      // is enforced against SQLite when the share is actually opened.
      this.assertViewLimit(share.views, share.security.maxViews);
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
