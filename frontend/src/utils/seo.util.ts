import Config from "../types/config.type";

export const DEFAULT_SITE_NAME = "Pingvin Share";

export const DEFAULT_SITE_DESCRIPTION =
  "Fast, private file sharing with short links, previews and download controls.";

export const normalizeBaseUrl = (value?: string): string =>
  (value ?? "").trim().replace(/\/+$/, "");

export const getConfigValue = (config: Config[], key: string): string => {
  const variable = config.find((item) => item.key === key);
  return (variable?.value ?? variable?.defaultValue ?? "").trim();
};

export const getSiteName = (config: Config[]): string =>
  getConfigValue(config, "general.appName") || DEFAULT_SITE_NAME;

export const getConfiguredSiteUrl = (config: Config[]): string =>
  normalizeBaseUrl(getConfigValue(config, "general.appUrl"));

export const getCanonicalPath = (asPath: string): string => {
  const path = (asPath || "/").split("?")[0].split("#")[0];
  return path.startsWith("/") ? path || "/" : `/${path}`;
};

export const absoluteUrl = (path: string, baseUrl: string): string => {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return path;

  try {
    return new URL(path, `${base}/`).toString();
  } catch {
    return path;
  }
};

/**
 * The single WebSite entity every page graph points at. Keeping the `@id` in
 * one helper makes the Organization/WebSite graph and the page-level
 * `isPartOf` references agree.
 */
export const buildWebsiteRef = (siteName: string, baseUrl: string) => ({
  "@type": "WebSite",
  name: siteName,
  url: absoluteUrl("/", baseUrl),
});

export const buildCollectionPage = ({
  name,
  description,
  path,
  siteName,
  baseUrl,
  datePublished,
  dateModified,
  mainEntity,
}: {
  name: string;
  description: string;
  path: string;
  siteName: string;
  baseUrl: string;
  datePublished?: string;
  dateModified?: string;
  mainEntity?: Record<string, unknown>;
}) => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name,
  description,
  url: absoluteUrl(path, baseUrl),
  ...(datePublished ? { datePublished } : {}),
  ...(dateModified ? { dateModified } : {}),
  isPartOf: buildWebsiteRef(siteName, baseUrl),
  ...(mainEntity ? { mainEntity } : {}),
});

export const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/"/g, "&quot;")
    .replaceAll("'", "&apos;");

export const serializeJsonLd = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");
