import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "pingvin_visitor";
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

// These responses must stay free of Set-Cookie so Cloudflare can cache them.
// HEAD is only used for share existence checks, and its route skips the visitor
// limiter. Without a cookie the visitor key falls back to the IP address.
const IDENTITY_FREE_PATHS = new Set([
  "/api/configs",
  "/api/health",
  "/api/system/stats",
]);

type VisitorRequest = Request & {
  cookies?: Record<string, string>;
  visitorKey?: string;
};

function skipsVisitorIdentity(req: Request) {
  return (
    req.method === "HEAD" ||
    req.method === "OPTIONS" ||
    (req.method === "GET" &&
      IDENTITY_FREE_PATHS.has(req.path.replace(/\/+$/, "")))
  );
}

async function verifyVisitorId(
  jwt: JwtService,
  token: unknown,
  secret: string,
) {
  if (typeof token !== "string") return undefined;

  try {
    const payload = await jwt.verifyAsync<{ sub?: string }>(token, { secret });
    return payload?.sub;
  } catch {
    return undefined;
  }
}

/**
 * Identifies a visitor for the global rate limiter. Logged-in requests use the
 * verified JWT subject; guests use a signed, persistent cookie. Missing or
 * forged cookies fall back to the IP address on that request so clearing
 * cookies cannot grant unlimited new buckets.
 */
export function createVisitorIdentityMiddleware(
  jwt: JwtService,
  jwtSecret: string,
  secureCookies: boolean,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const req = request as VisitorRequest;

    if (skipsVisitorIdentity(req)) {
      req.visitorKey = `ip:${req.ip || "unknown"}`;
      next();
      return;
    }

    const cookies = req.cookies ?? {};
    const cookieVisitorId = await verifyVisitorId(
      jwt,
      cookies[COOKIE_NAME],
      jwtSecret,
    );

    if (!cookieVisitorId) {
      response.cookie(
        COOKIE_NAME,
        await jwt.signAsync(
          {},
          {
            secret: jwtSecret,
            subject: randomUUID(),
            expiresIn: "365d",
          },
        ),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: secureCookies,
          maxAge: COOKIE_MAX_AGE,
          path: "/",
        },
      );
    }

    let userId: string | undefined;
    const accessToken = cookies.access_token;
    if (typeof accessToken === "string" && accessToken) {
      try {
        const payload = await jwt.verifyAsync<{ sub?: string }>(accessToken, {
          secret: jwtSecret,
        });
        if (payload?.sub) userId = payload.sub;
      } catch {
        // Expired or invalid tokens fall back to the visitor cookie/IP.
      }
    }

    req.visitorKey = userId
      ? `user:${userId}`
      : cookieVisitorId
        ? `visitor:${cookieVisitorId}`
        : `ip:${req.ip || "unknown"}`;

    next();
  };
}
