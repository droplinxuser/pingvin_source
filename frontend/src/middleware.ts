import { jwtDecode } from "jwt-decode";
import { NextRequest, NextResponse } from "next/server";
import { getConfig as readConfig } from "./utils/config.util";
import { fetchConfig } from "./utils/config.server.util";
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

  if (!getConfig("legal.enabled")) {
    routes.disabled.routes.push("/imprint", "/privacy");
  } else {
    if (!getConfig("legal.imprintText") && !getConfig("legal.imprintUrl")) {
      routes.disabled.routes.push("/imprint");
    }
    if (
      !getConfig("legal.privacyPolicyText") &&
      !getConfig("legal.privacyPolicyUrl")
    ) {
      routes.disabled.routes.push("/privacy");
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
    // Imprint redirect
    {
      condition: route == "/imprint" && !getConfig("legal.imprintText") && getConfig("legal.imprintUrl"),
      path: getConfig("legal.imprintUrl"),
    },
    // Privacy redirect
    {
      condition: route == "/privacy" && !getConfig("legal.privacyPolicyText") && getConfig("legal.privacyPolicyUrl"),
      path: getConfig("legal.privacyPolicyUrl"),
    },
  ];
  for (const rule of rules) {
    if (rule.condition) {
      let { path } = rule;

      if (path == "/auth/signIn") {
        path = path + "?redirect=" + encodeURIComponent(route);
      }
      const response = NextResponse.redirect(new URL(path, request.url));
      response.headers.set("Vary", "x-nextjs-data");
      setCacheHeaders(response, "no-store");
      return response;
    }
  }

  const response = NextResponse.next();
  const configuredDefaultLanguage = getConfig(
    "general.defaultLanguage",
  ) as string;
  const defaultLanguage = configuredDefaultLanguage || "en-US";
  const language = request.cookies.get("language")?.value || defaultLanguage;
  const colorSchemeCookie = request.cookies.get("mantine-color-scheme")?.value;

  if (
    isPublicPageRoute(route) &&
    !user &&
    !isConfigFallback &&
    // Query strings can carry recipient identifiers or language/theme
    // overrides; only clean, anonymous URLs may be shared between visitors.
    !request.nextUrl.search &&
    // The shell embeds colorScheme in __NEXT_DATA__. The default is light, so
    // a light preference produces the same shell; other themes bypass cache.
    (colorSchemeCookie === undefined || colorSchemeCookie === "light") &&
    language === defaultLanguage
  ) {
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
