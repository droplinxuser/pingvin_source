import { HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { NO_STORE_HEADERS } from "./cache.util";

/**
 * File downloads are only served when the request's Referer header belongs
 * to the configured app URL, so files cannot be hotlinked from other sites.
 * Requests with a missing or foreign referrer are redirected to the share
 * page instead (see redirectToSharePage).
 */
export function isRequestFromApp(req: Request, appUrl: string): boolean {
  const referrer = req.headers.referer ?? req.headers["referrer"];
  if (!referrer || Array.isArray(referrer)) return false;

  try {
    const referrerUrl = new URL(referrer);
    const parsedAppUrl = new URL(appUrl);

    // http and https are treated as equal (TLS is usually terminated by a
    // reverse proxy); the URL parser already ignores trailing slashes
    const protocolMatches =
      referrerUrl.protocol == parsedAppUrl.protocol ||
      (["http:", "https:"].includes(referrerUrl.protocol) &&
        ["http:", "https:"].includes(parsedAppUrl.protocol));

    const appUrlPath = parsedAppUrl.pathname.replace(/\/+$/, "");
    const pathMatches =
      !appUrlPath ||
      referrerUrl.pathname == appUrlPath ||
      referrerUrl.pathname.startsWith(`${appUrlPath}/`);

    return (
      protocolMatches && referrerUrl.host == parsedAppUrl.host && pathMatches
    );
  } catch {
    return false;
  }
}

/**
 * Redirects to the share page with a 302 status. Unlike 301, Cloudflare
 * does not cache 302 by default; the explicit no-store headers make sure
 * neither Cloudflare nor the browser stores the redirect.
 */
export function redirectToSharePage(
  res: Response,
  appUrl: string,
  shareId: string,
) {
  res.status(HttpStatus.FOUND).set({
    Location: `${String(appUrl).replace(/\/+$/, "")}/share/${shareId}`,
    ...NO_STORE_HEADERS,
  });
}
