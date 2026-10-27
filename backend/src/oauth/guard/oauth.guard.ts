import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class OAuthGuard implements CanActivate {
  constructor() {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provider = request.params.provider;
    const state = request.query.state;
    const expected = request.cookies[`oauth_${provider}_state`];

    // Both sides must be present. `undefined === undefined` would otherwise
    // accept a callback that carries no state at all.
    return (
      typeof state === "string" &&
      state.length > 0 &&
      typeof expected === "string" &&
      expected.length > 0 &&
      state === expected
    );
  }
}
