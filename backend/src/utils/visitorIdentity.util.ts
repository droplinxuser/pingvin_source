import { JwtService } from "@nestjs/jwt";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "pingvin_visitor";
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VisitorRequest = Request & {
  cookies?: Record<string, string>;
  visitorKey?: string;
};

function sign(visitorId: string, secret: string) {
  return createHmac("sha256", secret).update(visitorId).digest("base64url");
}

export function signVisitorId(visitorId: string, secret: string) {
  return `${visitorId}.${sign(visitorId, secret)}`;
}

export function verifyVisitorId(value: unknown, secret: string) {
  if (typeof value !== "string") return undefined;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return undefined;

  const visitorId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!UUID_PATTERN.test(visitorId)) return undefined;

  const expected = sign(visitorId, secret);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return undefined;
  }

  return visitorId;
}

/**
 * Identifies a visitor for the global rate limiter. Logged-in requests use the
 * verified JWT subject; guests use a signed, persistent cookie. Missing or
 * forged cookies fall back to the IP address so clearing cookies cannot grant
 * unlimited new buckets.
 */
export function createVisitorIdentityMiddleware(
  jwt: JwtService,
  jwtSecret: string,
  secureCookies: boolean,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const req = request as VisitorRequest;
    const cookies = req.cookies ?? {};
    const cookieVisitorId = verifyVisitorId(cookies[COOKIE_NAME], jwtSecret);

    if (!cookieVisitorId) {
      response.cookie(COOKIE_NAME, signVisitorId(randomUUID(), jwtSecret), {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
      });
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
