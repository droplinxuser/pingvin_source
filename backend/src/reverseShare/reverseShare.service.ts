import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { Cache } from "cache-manager";
import { I18nService } from "nestjs-i18n";
import { ConfigService } from "src/config/config.service";
import { FileService } from "src/file/file.service";
import { TrendingService } from "src/cache/trending.service";
import { SearchService } from "src/cache/search.service";
import { PrismaService } from "src/prisma/prisma.service";
import { VirusTotalQueueService } from "src/virustotal/virustotalQueue.service";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";
import { invalidateShareDataCache } from "src/utils/cache.util";
import { SHARE_EXPIRATION, parseSizeLimit } from "src/share/share.util";
import { CreateReverseShareDTO } from "./dto/createReverseShare.dto";

@Injectable()
export class ReverseShareService {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private fileService: FileService,
    private readonly i18n: I18nService,
    private readonly trending: TrendingService,
    private readonly search: SearchService,
    private readonly virusTotalQueue: VirusTotalQueueService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async create(data: CreateReverseShareDTO, creatorId: string) {
    // Expiration is automatic and immutable: reverse shares default to 100 days
    const expirationDate = parseRelativeDateToAbsolute(SHARE_EXPIRATION);

    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });
    if (!creator)
      throw new BadRequestException(this.i18n.t("auth.userNotFound"));

    if (creator.allowCreateReverseShares === false) {
      throw new ForbiddenException(
        this.i18n.t("reverseShare.notAllowedToCreate"),
      );
    }

    // A reverse share is still a way to create shares. Do not let an account
    // with sharing disabled use one to bypass that restriction.
    if (creator.allowShare === false) {
      throw new ForbiddenException(this.i18n.t("share.notAllowedToShare"));
    }

    if (creator.maxReverseShares != null && creator.maxReverseShares > 0) {
      const activeReverseSharesCount = await this.prisma.reverseShare.count({
        where: {
          creatorId,
          shareExpiration: { gt: new Date() },
        },
      });
      if (activeReverseSharesCount >= creator.maxReverseShares) {
        throw new BadRequestException(
          this.i18n.t("reverseShare.maxReverseSharesExceeded", {
            args: { max: creator.maxReverseShares },
          }),
        );
      }
    }

    const userMaxShareSize = creator?.shareSizeLimit
      ? parseSizeLimit(
          creator.shareSizeLimit,
          parseInt(this.config.get("share.maxSize")),
        )
      : parseInt(this.config.get("share.maxSize"));
    const requestedShareSize = Number(data.maxShareSize);

    if (
      !Number.isSafeInteger(requestedShareSize) ||
      requestedShareSize <= 0 ||
      userMaxShareSize < requestedShareSize
    )
      throw new BadRequestException(
        this.i18n.t("reverseShare.maxShareSizeExceeded", {
          args: { maxSize: userMaxShareSize },
        }),
      );

    if (data.token) {
      if (!(await this.isReverseShareTokenAvailable(data.token)).isAvailable) {
        throw new BadRequestException(this.i18n.t("reverseShare.tokenInUse"));
      }
    }

    try {
      const reverseShare = await this.prisma.reverseShare.create({
        data: {
          token: data.token || undefined,
          shareExpiration: expirationDate,
          remainingUses: data.maxUseCount,
          maxShareSize: data.maxShareSize,
          sendEmailNotification: data.sendEmailNotification,
          simplified: data.simplified,
          publicAccess: data.publicAccess,
          creatorId,
        },
      });

      return reverseShare.token;
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
        throw new BadRequestException(this.i18n.t("reverseShare.tokenInUse"));
      }
      throw e;
    }
  }

  async isReverseShareTokenAvailable(token: string) {
    const reverseShare = await this.prisma.reverseShare.findUnique({
      where: { token },
      select: { id: true },
    });
    return { isAvailable: !reverseShare };
  }

  async getByToken(reverseShareToken?: string) {
    if (!reverseShareToken) return null;

    const reverseShare = await this.prisma.reverseShare.findUnique({
      where: { token: reverseShareToken },
      include: { creator: { select: { id: true, storageQuotaLimit: true } } },
    });

    return reverseShare;
  }

  private isUsable(reverseShare: {
    shareExpiration: Date;
    remainingUses: number;
  }): boolean {
    return (
      new Date() <= reverseShare.shareExpiration &&
      reverseShare.remainingUses > 0
    );
  }

  /**
   * Validates and loads a reverse share in one query. Used by creation flows
   * that need the owner's storage quota.
   */
  async getValidByToken(reverseShareToken?: string) {
    const reverseShare = await this.getByToken(reverseShareToken);
    return reverseShare && this.isUsable(reverseShare) ? reverseShare : null;
  }

  /**
   * Public reverse-share payload. It deliberately loads no creator fields so
   * the upload page never reads account data it does not render.
   */
  async getPublicByToken(reverseShareToken?: string) {
    if (!reverseShareToken) return null;

    const reverseShare = await this.prisma.reverseShare.findUnique({
      where: { token: reverseShareToken },
      select: {
        id: true,
        token: true,
        shareExpiration: true,
        remainingUses: true,
        maxShareSize: true,
        simplified: true,
      },
    });

    // Keep the upload form readable until the reverse share expires. Uses are
    // enforced atomically when a share is created, so an upload that consumed
    // the final use can still reload the page and resume its in-progress share
    // instead of losing the page with a false "invalid" error.
    return reverseShare && new Date() <= reverseShare.shareExpiration
      ? reverseShare
      : null;
  }

  async getAllByUser(userId: string) {
    const reverseShares = await this.prisma.reverseShare.findMany({
      where: {
        creatorId: userId,
        shareExpiration: { gt: new Date() },
      },
      orderBy: {
        shareExpiration: "desc",
      },
      // The response only exposes the public creator fields, so never load the
      // full user row (password/TOTP secrets) for every reverse-share upload.
      include: {
        shares: {
          include: {
            creator: {
              select: {
                id: true,
                username: true,
                displayName: true,
                shareSizeLimit: true,
              },
            },
          },
        },
      },
    });

    return reverseShares;
  }

  /**
   * Atomically consumes one use before a reverse-share upload is created.
   * Doing this at creation (instead of completion) closes the race where
   * parallel requests all pass the `remainingUses > 0` check.
   */
  async reserveUse(reverseShareToken?: string): Promise<boolean> {
    if (!reverseShareToken) return false;

    const { count } = await this.prisma.reverseShare.updateMany({
      where: {
        token: reverseShareToken,
        remainingUses: { gt: 0 },
        shareExpiration: { gt: new Date() },
      },
      data: { remainingUses: { decrement: 1 } },
    });
    return count > 0;
  }

  /** Returns a reserved use when the share could not be created. */
  async refundUse(reverseShareToken?: string): Promise<void> {
    if (!reverseShareToken) return;
    await this.prisma.reverseShare
      .updateMany({
        where: { token: reverseShareToken },
        data: { remainingUses: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  async isValid(reverseShareToken: string) {
    const reverseShare = await this.prisma.reverseShare.findUnique({
      where: { token: reverseShareToken },
      select: { shareExpiration: true, remainingUses: true },
    });

    return !!reverseShare && this.isUsable(reverseShare);
  }

  async remove(id: string) {
    const shares = await this.prisma.share.findMany({
      where: { reverseShareId: id },
      select: { id: true },
    });

    await this.prisma.share.updateMany({
      where: { reverseShareId: id },
      data: {
        reverseShareId: null,
        expiration: new Date(),
      },
    });

    await this.prisma.reverseShare.delete({ where: { id } });
    const shareIds = shares.map((share) => share.id);
    await Promise.all([
      ...shareIds.map((shareId) =>
        invalidateShareDataCache(this.cache, shareId),
      ),
      ...shareIds.map((shareId) =>
        this.virusTotalQueue.removeForShare(shareId),
      ),
      this.trending.invalidate(shareIds),
      this.search.invalidate(),
    ]);
  }
}
