import { HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { NO_STORE_HEADERS } from "./cache.util";

// http and https are treated as equal because TLS is usually terminated by a
// reverse proxy. A same-origin referrer is always the app itself, so previews
// and downloads keep working when the instance is opened through an alias host
// (www/non-www, a LAN name or a fresh install that still has the placeholder
// app URL). A foreign referrer is still rejected, which is what hotlink
// protection is for.
export function isRequestFromApp(req: Request, appUrl: string): boolean {
  const referrer = req.headers.referer ?? req.headers["referrer"];
  if (!referrer || Array.isArray(referrer)) return false;

  let ref: URL;
  try {
    ref = new URL(referrer);
  } catch {
    return false;
  }

  const requestHost = req.headers.host;
  if (requestHost && ref.host === requestHost) return true;

  let app: URL;
  try {
    app = new URL(appUrl);
  } catch {
    return false;
  }

  // TLS may terminate at the proxy, so compare hosts and paths only.
  const appPath = app.pathname.replace(/\/+$/, "");
  return (
    ref.host === app.host &&
    (!appPath ||
      ref.pathname === appPath ||
      ref.pathname.startsWith(`${appPath}/`))
  );
}

/**
 * The path part of the configured app URL (empty for the development
 * placeholder or a root deployment). Keeping it lets a sub-path install
 * redirect to `/files/share/<id>` instead of the domain root.
 */
function getAppPath(appUrl: string): string {
  try {
    return new URL(appUrl).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * Redirects to the share page with a 302 status. The location stays relative so
 * the browser resolves it against the host it actually used; the configured app
 * URL may still hold the development placeholder on a fresh install, and an
 * absolute URL built from it would send the visitor to `localhost`. The
 * explicit no-store headers stop Cloudflare and browsers from caching the
 * redirect.
 */
export function redirectToSharePage(
  res: Response,
  appUrl: string,
  shareId: string,
) {
  res.status(HttpStatus.FOUND).set({
    Location: `${getAppPath(appUrl)}/share/${shareId}`,
    ...NO_STORE_HEADERS,
  });
}
