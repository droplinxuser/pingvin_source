import { jwtDecode } from "jwt-decode";
import { NextRequest, NextResponse } from "next/server";
import { getConfig as readConfig } from "./utils/config.util";
import { fetchConfig } from "./utils/config.server.util";
import { checkPageRateLimit } from "./utils/pageRateLimit.util";
import { isPublicPageRoute } from "./utils/router.util";

// This middleware redirects based on different conditions:
// - Authentication state
// - Setup status
// - Admin privileges

export const config = {
  matcher: "/((?!api|static|.*\\..*|_next).*)",
};

// Keep this short: the HTML contains the build ID used by client navigation.
// A long CDN TTL serves an old build after a deployment and breaks navigation.
const PUBLIC_CACHE =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=30, stale-if-error=300";
const CACHE_HEADERS = [
  "Cache-Control",
  "CDN-Cache-Control",
  "Cloudflare-CDN-Cache-Control",
];

function setCacheHeaders(response: NextResponse, value: string) {
  for (const header of CACHE_HEADERS) response.headers.set(header, value);
}

export async function middleware(request: NextRequest) {
  const routes = {
    unauthenticated: new Routes(["/auth/*", "/"]),
    admin: new Routes(["/admin", "/admin/*"]),
    account: new Routes(["/account", "/account/*"]),
    disabled: new Routes([]),
  };

  // Get config from the backend with a timeout and fallback
  const apiUrl = process.env.API_URL || "http://localhost:8080";
  const { config, fallback: isConfigFallback } = await fetchConfig(apiUrl);

  const getConfig = (key: string) => {
    return readConfig(key, config);
  };

  const route = request.nextUrl.pathname;
  let user: { isAdmin: boolean } | null = null;
  const accessToken = request.cookies.get("access_token")?.value;

  try {
    const claims = jwtDecode<{ exp: number; isAdmin: boolean }>(
      accessToken as string,
    );
    if (claims.exp * 1000 > Date.now()) {
      user = claims;
    }
  } catch {
    user = null;
  }

  if (!getConfig("security.allowRegistration")) {
    routes.disabled.routes.push("/auth/signUp");
  }

  if (!getConfig("smtp.enabled")) {
    routes.disabled.routes.push("/auth/resetPassword", "/auth/resetPassword/*");
  }

  const configuredDefaultLanguage = getConfig(
    "general.defaultLanguage",
  ) as string;
  const defaultLanguage = configuredDefaultLanguage || "en-US";
  const language = request.cookies.get("language")?.value || defaultLanguage;
  const colorSchemeCookie = request.cookies.get("mantine-color-scheme")?.value;

  // Cacheable anonymous public shells are absorbed by Cloudflare and do not
  // consume the visitor budget. Everything else (auth/account/admin/upload,
  // signed-in or theme/query variants, redirects and 404s) uses the same
  // IP limit as the API visitor bucket. Link prefetches are cheap
  // background reads and must not exhaust the budget before a visitor follows
  // the link, so they are never counted.
  const isPrefetch = request.headers.get("x-middleware-prefetch") === "1";
  const publicShellEligible =
    isPublicPageRoute(route) &&
    !user &&
    !isConfigFallback &&
    !request.nextUrl.search &&
    (colorSchemeCookie === undefined || colorSchemeCookie === "light") &&
    language === defaultLanguage;

  if (!publicShellEligible && !isPrefetch) {
    const limit = await checkPageRateLimit(request);
    if (!limit.allowed) {
      const response = new NextResponse(
        "Too many requests. Please try again shortly.",
        {
          status: 429,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Retry-After": String(limit.retryAfter ?? 60),
          },
        },
      );
      setCacheHeaders(response, "no-store");
      return response;
    }
  }

  // prettier-ignore
  const rules = [
    // Disabled routes
    {
      condition: routes.disabled.contains(route),
      path: "/",
    },
     // Authenticated state
     {
      condition: user && routes.unauthenticated.contains(route) && !getConfig("security.allowUnauthenticatedShares"),
      path: "/upload",
    },
    // Unauthenticated state: only known protected routes require sign-in.
    // Unknown paths are left to Next.js so they render the 404 page with a
    // 404 status instead of being redirected to sign-in.
    {
      condition: !user && !getConfig("security.allowUnauthenticatedShares") && (routes.account.contains(route) || routes.admin.contains(route) || route == "/upload"),
      path: "/auth/signIn",
    },
    {
      condition: !user && routes.account.contains(route),
      path: "/upload",
    },
    // Admin privileges
    {
      condition: routes.admin.contains(route) && !user?.isAdmin,
      path: "/upload",
    },
    // Home page
    {
      condition: (!getConfig("general.showHomePage") || user) && route == "/",
      path: "/upload",
    },
  ];
  for (const rule of rules) {
    if (rule.condition) {
      let { path } = rule;

      if (path == "/auth/signIn") {
        path =
          path +
          "?redirect=" +
          encodeURIComponent(`${route}${request.nextUrl.search}`);
      }
      const response = NextResponse.redirect(new URL(path, request.url));
      response.headers.set("Vary", "x-nextjs-data");
      setCacheHeaders(response, "no-store");
      return response;
    }
  }

  const response = NextResponse.next();

  // Client-navigation data (`/_next/data/*`) is versioned by build ID and must
  // never be stored by a shared cache: after a deploy (or a transient empty
  // payload) a cached entry blanks the page until a hard reload. Next runs this
  // middleware for data requests with the *page* path, so detect them by the
  // header the router sends rather than by the resolved pathname.
  if (
    request.headers.get("x-nextjs-data") === "1" ||
    request.headers.get("x-middleware-prefetch") === "1" ||
    request.nextUrl.pathname.startsWith("/_next/data/")
  ) {
    setCacheHeaders(response, "no-store");
    return response;
  }

  if (publicShellEligible) {
    setCacheHeaders(response, PUBLIC_CACHE);
    // Do not vary on Cookie: Cloudflare ignores it for its cache key, and the
    // anonymous shell is intentionally shared. Signed-in requests are excluded
    // at the origin, but an edge cache hit can still deliver this shell to a
    // signed-in visitor; the client restores their session after hydration.
    // The shell language comes from the default-language config, so the browser
    // header only matters when that config value is missing.
    response.headers.set(
      "Vary",
      configuredDefaultLanguage
        ? "Accept-Encoding"
        : "Accept-Encoding, Accept-Language",
    );
  } else {
    setCacheHeaders(response, "no-store");
  }
  return response;
}

// Helper class to check if a route matches a list of routes
class Routes {
  // eslint-disable-next-line no-unused-vars
  constructor(public routes: string[]) {}

  contains(_route: string) {
    for (const route of this.routes) {
      if (new RegExp("^" + route.replace(/\*/g, ".*") + "$").test(_route))
        return true;
    }
    return false;
  }
}
