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
