import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Request } from "express";
import * as moment from "moment";
import { I18nService } from "nestjs-i18n";
import { PrismaService } from "src/prisma/prisma.service";
import { ShareService } from "src/share/share.service";
import { GuardShare } from "src/share/shareState.service";
import { isPublicShare } from "src/share/share.util";
import { ConfigService } from "src/config/config.service";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { User } from "@prisma/client";

@Injectable()
export class ShareSecurityGuard extends JwtGuard {
  constructor(
    private shareService: ShareService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private readonly i18n: I18nService,
  ) {
    super(configService);
  }

  protected async authenticateUser(
    context: ExecutionContext,
  ): Promise<User | undefined> {
    await super.canActivate(context);
    const request: Request = context.switchToHttp().getRequest();
    return request.user as User;
  }

  protected async isRecipient(
    share: {
      id: string;
      userRecipients: { userId: string }[];
      recipients: { email: string }[];
    },
    user?: User,
  ): Promise<boolean> {
    if (!user) return false;
    if (!this.configService.get("share.enableUserRecipients")) return false;

    // Already linked as a recipient of this share.
    const isLinked = share.userRecipients.some((r) => r.userId === user.id);
    if (isLinked) return true;

    // Otherwise, if the user's (account-verified) email matches one of the
    // share's recipients, grant access and link them
    const userEmail = user.email?.toLowerCase();
    const isEmailRecipient =
      !!userEmail &&
      share.recipients.some((r) => r.email.toLowerCase() === userEmail);
    if (isEmailRecipient) {
      await this.prisma.shareUserRecipient.upsert({
        where: { userId_shareId: { userId: user.id, shareId: share.id } },
        create: { userId: user.id, shareId: share.id },
        update: {},
      });
      return true;
    }
    return false;
  }

  async canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();

    const shareId = Object.prototype.hasOwnProperty.call(
      request.params,
      "shareId",
    )
      ? request.params.shareId
      : request.params.id;

    const shareToken = request.cookies[`share_${shareId}_token`];

    // FileSecurityGuard already loaded the same guard entry before delegating
    // here; reuse it instead of issuing a second cache read per file.
    const guardedRequest = request as Request & { guardShare?: GuardShare | null };
    const share =
      guardedRequest.guardShare === undefined
        ? await this.shareService.getGuardShare(shareId)
        : guardedRequest.guardShare;

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    const publicShare = isPublicShare(share);
    (request as Request & { shareIsPublic?: boolean }).shareIsPublic =
      publicShare;

    const expired =
      moment().isAfter(share.expiration) &&
      !moment(share.expiration).isSame(0);

    // A public, unexpired GET needs no account lookup. Skipping authentication
    // here keeps the share payload, comments and thumbnail reads from issuing
    // a refresh-token query for every signed-in visitor. Mutations still
    // authenticate so comment authors and admin previews keep working.
    if (publicShare && request.method === "GET" && !expired) return true;

    const user = await this.authenticateUser(context);

    // If admin access is enabled and user is admin, allow access
    if (
      user?.isAdmin &&
      this.configService.get("security.allowAdminAccessAllShares")
    ) {
      return true;
    }

    if (expired) {
      throw new NotFoundException(this.i18n.t("share.notFound"));
    }

    // If user sharing is enabled, check if the authenticated user is a recipient
    if (await this.isRecipient(share, user)) {
      return true;
    }

    // If share is restricted to named recipients, block everyone else (excluding the creator)
    if (
      share.security?.restrictToRecipients &&
      (!user || share.creatorId !== user.id)
    ) {
      throw new ForbiddenException(
        this.i18n.t("share.restrictedToRecipients"),
        "share_restricted_to_recipients",
      );
    }

    // Public shares need no token: their files are already readable without
    // one by the file guard. This saves the 403 -> token -> retry round trip.
    if (publicShare) return true;

    if (share.security?.password && !shareToken)
      throw new ForbiddenException(
        this.i18n.t("file.passwordProtected"),
        "share_password_required",
      );

    if (!(await this.shareService.verifyShareToken(share, shareToken)))
      throw new ForbiddenException(
        this.i18n.t("share.tokenRequired"),
        "share_token_required",
      );

    // Only the creator and reverse share creator can access the reverse share if it's not public
    if (
      share.reverseShare &&
      !share.reverseShare.publicAccess &&
      share.creatorId !== user?.id &&
      share.reverseShare.creatorId !== user?.id
    )
      throw new ForbiddenException(
        this.i18n.t("share.privateShare"),
        "private_share",
      );

    return true;
  }
}
