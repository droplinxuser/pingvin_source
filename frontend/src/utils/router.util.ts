/**
 * Routes whose anonymous HTML shell contains no account-specific data and can
 * be shared by the edge cache. Used by both the middleware and App so they
 * apply the same cache/privacy policy.
 */
export function isPublicPageRoute(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/trending" ||
    /^\/share\/[^/]+\/?$/.test(pathname) ||
    pathname === "/imprint" ||
    pathname === "/privacy"
  );
}

export function safeRedirectPath(path: string | undefined) {
  if (!path) return "/";

  // Reject absolute URLs, protocol-relative URLs and backslash tricks before
  // the missing leading slash is added for a normal app path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return "/";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.startsWith("//") || normalized.includes("\\")) return "/";

  try {
    const base = "https://internal.invalid";
    if (new URL(normalized, base).origin !== base) return "/";
  } catch {
    return "/";
  }

  return normalized;
}

export function getQueryString(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}
