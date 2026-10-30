import {
  ExecutionContext,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { I18nService } from "nestjs-i18n";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import { JwtGuard } from "../../auth/guard/jwt.guard";

@Injectable()
export class ShareOwnerGuard extends JwtGuard {
  constructor(
    protected configService: ConfigService,
    private prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly jwtService: JwtService,
  ) {
    super(configService);
  }

  isBase64(toCheck: string) {
    const isBase64 = /^[a-zA-Z0-9_-]*={0,2}$/.test(toCheck);
    return isBase64;
  }

  async canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();
    const shareId = Object.prototype.hasOwnProperty.call(
      request.params,
      "shareId",
    )
      ? request.params.shareId
      : request.params.id;

    if (!this.isBase64(shareId)) {
      throw new BadRequestException(this.i18n.t("file.invalidIdFormat"));
    }

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { security: true, reverseShare: true },
    });

    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));

    (request as any).share = share;

    // Run the JWTGuard to set the user
    await super.canActivate(context);
    const user = request.user as User;

    // If the user is the creator of the share or the parent reverse share
    if (
      user &&
      (share.creatorId === user.id ||
        (this.allowAdmin && share.reverseShare?.creatorId === user.id))
    ) {
      return true;
    }

    // If the user is an admin, allow access
    if (this.allowAdmin && user?.isAdmin) return true;

    // If it's a anonymous share, allow access
    if (this.allowAnonymous && !share.creatorId) {
      if (share.reverseShare) {
        const reverseShareToken = request.cookies?.reverse_share_token;
        return (
          Boolean(reverseShareToken) &&
          reverseShareToken === share.reverseShare.token
        );
      }

      // Guest uploads are managed with a per-share capability cookie issued
      // when the share is created. Without it, anyone holding the public link
      // could delete files, revert completion or upload replacement files.
      const ownerToken = request.cookies?.[`share_${shareId}_owner`];
      if (ownerToken && this.isShareOwnerToken(shareId, ownerToken)) {
        return true;
      }

      return false;
    }

    // If not signed in, deny access
    if (!user) return false;

    return false;
  }

  private isShareOwnerToken(shareId: string, token: string): boolean {
    try {
      const claims = this.jwtService.verify<{ shareOwner?: string }>(token, {
        secret: this.configService.get("internal.jwtSecret"),
      });
      return claims.shareOwner === shareId;
    } catch {
      return false;
    }
  }

  protected get allowAdmin(): boolean {
    return true;
  }

  protected get allowAnonymous(): boolean {
    return true;
  }
}
