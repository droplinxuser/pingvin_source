/**
 * Routes whose anonymous HTML shell contains no account-specific data and can
 * be shared by the edge cache. Used by both the middleware and App so they
 * apply the same cache/privacy policy.
 */
export function isPublicPageRoute(pathname: string) {
  return (
    pathname === "/" ||
    /^\/share\/[^/]+\/?$/.test(pathname) ||
    pathname === "/imprint" ||
    pathname === "/privacy"
  );
}

export function safeRedirectPath(path: string | undefined) {
  if (!path) return "/";

  const normalized = path.startsWith("/") ? path : `/${path}`;

  // Do not allow protocol-relative or backslash redirects to another origin.
  if (normalized.startsWith("//") || normalized.includes("\\")) return "/";

  return normalized;
}

export function getQueryString(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}
