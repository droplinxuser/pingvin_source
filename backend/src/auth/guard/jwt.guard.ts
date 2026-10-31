import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ConfigService } from "src/config/config.service";

@Injectable()
export class JwtGuard extends AuthGuard("jwt") {
  constructor(protected config: ConfigService) {
    super();
  }

  /**
   * Routes that may serve an anonymous request (notably share creation while
   * `allowUnauthenticatedShares` is enabled) opt in to the config fallback.
   * Every other route fails closed, so an unauthenticated caller gets a normal
   * 401/403 instead of reaching a handler that dereferences `request.user`.
   */
  protected get allowUnauthenticated(): boolean {
    return false;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = await Promise.resolve(
      super.canActivate(context),
    ).catch(() => false);
    if (authenticated) return true;

    return (
      this.allowUnauthenticated === true &&
      this.config.get("security.allowUnauthenticatedShares") === true
    );
  }
}
