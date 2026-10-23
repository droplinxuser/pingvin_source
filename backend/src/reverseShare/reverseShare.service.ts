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
import { PrismaService } from "src/prisma/prisma.service";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";
import { invalidateShareDataCache } from "src/utils/cache.util";
import { SHARE_EXPIRATION } from "src/share/share.util";
import { CreateReverseShareDTO } from "./dto/createReverseShare.dto";

@Injectable()
export class ReverseShareService {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private fileService: FileService,
    private readonly i18n: I18nService,
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
      ? parseInt(creator.shareSizeLimit)
      : parseInt(this.config.get("share.maxSize"));

    if (userMaxShareSize < parseInt(data.maxShareSize))
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
    });
    return { isAvailable: !reverseShare };
  }

  async getByToken(reverseShareToken?: string) {
    if (!reverseShareToken) return null;

    const reverseShare = await this.prisma.reverseShare.findUnique({
      where: { token: reverseShareToken },
      include: { creator: true },
    });

    return reverseShare;
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
      include: { shares: { include: { creator: true } } },
    });

    return reverseShares;
  }

  async isValid(reverseShareToken: string) {
    const reverseShare = await this.prisma.reverseShare.findUnique({
      where: { token: reverseShareToken },
    });

    if (!reverseShare) return false;

    const isExpired = new Date() > reverseShare.shareExpiration;
    const remainingUsesExceeded = reverseShare.remainingUses <= 0;

    return !(isExpired || remainingUsesExceeded);
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
    await Promise.all(
      shares.map((share) => invalidateShareDataCache(this.cache, share.id)),
    );
  }
}
