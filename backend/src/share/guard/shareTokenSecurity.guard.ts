import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Request } from "express";
import { I18nService } from "nestjs-i18n";
import { ShareService } from "src/share/share.service";
import { isShareExpired } from "src/share/share.util";

@Injectable()
export class ShareTokenSecurity implements CanActivate {
  constructor(
    private shareService: ShareService,
    private readonly i18n: I18nService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();
    const shareId = Object.prototype.hasOwnProperty.call(
      request.params,
      "shareId",
    )
      ? request.params.shareId
      : request.params.id;

    // Reuse the short-lived guard cache. The share page's 403 already loaded
    // this entry, so issuing a token no longer runs a second SQLite query.
    const share = await this.shareService.getGuardShare(shareId);

    if (!share || isShareExpired(share.expiration))
      throw new NotFoundException(this.i18n.t("share.notFound"));

    return true;
  }
}
