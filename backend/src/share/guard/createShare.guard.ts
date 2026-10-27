import { ExecutionContext, Injectable } from "@nestjs/common";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { ConfigService } from "src/config/config.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";

@Injectable()
export class CreateShareGuard extends JwtGuard {
  constructor(
    configService: ConfigService,
    private reverseShareService: ReverseShareService,
  ) {
    super(configService);
  }

  /**
   * Only guards share creation. A reverse-share use is reserved during that
   * request, so later upload/complete/removal routes must rely on
   * StrictShareOwnerGuard (which matches the linked token) instead; calling
   * isValid() there would reject the in-progress upload with no remaining use.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (await super.canActivate(context)) return true;

    const request = context.switchToHttp().getRequest();
    const reverseShareTokenId = request.cookies?.reverse_share_token;

    if (!reverseShareTokenId) {
      return false;
    }

    return await this.reverseShareService.isValid(reverseShareTokenId);
  }
}
