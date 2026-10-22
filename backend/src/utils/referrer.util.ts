import { HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { NO_STORE_HEADERS } from "./cache.util";

// http and https are treated as equal because TLS is usually terminated by a
// reverse proxy. The host always has to match the configured app URL.
export function isRequestFromApp(req: Request, appUrl: string): boolean {
  const referrer = req.headers.referer ?? req.headers["referrer"];
  if (!referrer || Array.isArray(referrer)) return false;

  try {
    const ref = new URL(referrer);
    const app = new URL(appUrl);
    const isHttp = (protocol: string) =>
      protocol === "http:" || protocol === "https:";
    const appPath = app.pathname.replace(/\/+$/, "");

    return (
      ref.host === app.host &&
      (ref.protocol === app.protocol ||
        (isHttp(ref.protocol) && isHttp(app.protocol))) &&
      (!appPath ||
        ref.pathname === appPath ||
        ref.pathname.startsWith(`${appPath}/`))
    );
  } catch {
    return false;
  }
}

/**
 * Redirects to the share page with a 302 status. The explicit no-store headers
 * stop Cloudflare and browsers from caching the redirect.
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
