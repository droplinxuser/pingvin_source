import Config from "../types/config.type";
import { getBaseName, getShareThumbnailUrl } from "./file.util";
import { getFileMimeType } from "./mime.util";

export const DEFAULT_SITE_NAME = "DropMB";

export const DEFAULT_SITE_DESCRIPTION =
  "Fast, private file sharing with short links, previews and download controls.";

export const META_DESCRIPTION_LENGTH = 160;

export const normalizeBaseUrl = (value?: string): string =>
  (value ?? "").trim().replace(/\/+$/, "");

/**
 * Search results and social cards cut long descriptions off mid-sentence.
 * Keep the SEO text within the usual 160-character window and break on a word
 * boundary so the fallback metadata stays readable.
 */
export const truncateMetaText = (
  value: string,
  maxLength = META_DESCRIPTION_LENGTH,
): string => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, Math.max(maxLength - 1, 1));
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const getConfigValue = (
  config: Config[] | undefined,
  key: string,
): string => {
  const variable = (config ?? []).find((item) => item.key === key);
  return (variable?.value ?? variable?.defaultValue ?? "").trim();
};

export const getSiteName = (config: Config[]): string =>
  getConfigValue(config, "general.appName") || DEFAULT_SITE_NAME;

export const getConfiguredSiteUrl = (config: Config[]): string =>
  normalizeBaseUrl(getConfigValue(config, "general.appUrl"));

export const getCanonicalPath = (asPath: string): string => {
  const path = (asPath || "/").split("?")[0].split("#")[0];
  const absolute = path.startsWith("/") ? path || "/" : `/${path}`;
  // Next.js accepts /share/id and /share/id/; the sitemap only lists the
  // former. Strip the duplicate trailing-slash variant from canonicals.
  return absolute === "/" ? absolute : absolute.replace(/\/+$/, "");
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
  "@id": absoluteUrl("/#website", baseUrl),
  name: siteName,
  url: absoluteUrl("/", baseUrl),
});

export type BreadcrumbItem = { name: string; path: string };

export const buildBreadcrumbList = (
  items: BreadcrumbItem[],
  baseUrl: string,
) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path, baseUrl),
  })),
});

export const buildItemList = (
  items: { name: string; path: string; image?: string }[],
  baseUrl: string,
) => ({
  "@type": "ItemList",
  numberOfItems: items.length,
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    url: absoluteUrl(item.path, baseUrl),
    ...(item.image ? { image: absoluteUrl(item.image, baseUrl) } : {}),
  })),
});

export type SeoFileEntry = {
  id?: string;
  name: string;
  size?: string;
  createdAt?: string;
};

/**
 * Richer `ItemList` for a share's file list. Every entry describes the file
 * through a nested `DigitalDocument` with its identifier, MIME type, byte size
 * and creation date, so search engines can build richer file/media snippets
 * without pointing at a non-indexable API URL.
 */
export const buildFileListJsonLd = (files: SeoFileEntry[]) => ({
  "@type": "ItemList",
  numberOfItems: files.length,
  itemListElement: files.map((file, index) => {
    const name = getBaseName(file.name);
    const bytes = parseInt(file.size ?? "", 10);
    return {
      "@type": "ListItem",
      position: index + 1,
      name,
      item: {
        "@type": "DigitalDocument",
        name,
        ...(file.id ? { identifier: file.id } : {}),
        encodingFormat: getFileMimeType(file.name),
        ...(Number.isFinite(bytes) && bytes > 0
          ? { contentSize: `${bytes} B` }
          : {}),
        ...(file.createdAt
          ? { dateCreated: file.createdAt, dateModified: file.createdAt }
          : {}),
      },
    };
  }),
});

/**
 * Most shares have no owner-written name. Derive a stable, human-readable
 * label from the folder or first file instead of showing the random share id
 * in the page title, H1 and social cards.
 */
export const getShareSubject = (share?: {
  name?: string;
  files?: { name: string }[];
}): string | undefined => {
  const named = share?.name?.trim();
  if (named) return truncateMetaText(named, 48);

  const files = share?.files ?? [];
  if (files.length === 0) return undefined;

  const firstName = getBaseName(files[0].name);
  if (files.length === 1) return truncateMetaText(firstName, 48);

  const folders = files.map((file) => {
    const normalized = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = normalized.indexOf("/");
    return slash === -1 ? "" : normalized.slice(0, slash);
  });
  const folder = folders[0];
  if (folder && folders.every((value) => value === folder))
    return truncateMetaText(folder, 48);

  // A bulk upload usually ends in "name (1).jpg", "name (2).jpg". Drop the
  // extension and numeric suffix so the title reads "name", not "name (1)".
  const label = firstName
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)$/, "")
    .trim();
  return truncateMetaText(label || firstName, 48);
};

export const getShareFileNames = (
  files: { name: string }[] | undefined,
  limit = 3,
): string[] =>
  (files ?? []).slice(0, limit).map((file) => getBaseName(file.name));

export type ShareContentKind =
  | "photos"
  | "videos"
  | "audio"
  | "documents"
  | "archives";

const ARCHIVE_EXTENSION = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i;

const getShareFileKind = (name: string): ShareContentKind | undefined => {
  const mimeType = getFileMimeType(name);
  if (mimeType.startsWith("image/")) return "photos";
  if (mimeType.startsWith("video/")) return "videos";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("document") ||
    mimeType.includes("sheet") ||
    mimeType.includes("presentation")
  )
    return "documents";
  if (ARCHIVE_EXTENSION.test(getBaseName(name))) return "archives";
  return undefined;
};

/**
 * Coarse content mix for a share's meta description. The SEO payload contains
 * a sample of file names, so this intentionally says "including photos and
 * videos" instead of claiming an exact per-type count.
 */
export const getShareContentKinds = (
  files: { name: string }[] | undefined,
): ShareContentKind[] => {
  const kinds = new Set<ShareContentKind>();
  for (const file of files ?? []) {
    const kind = getShareFileKind(file.name);
    if (kind) kinds.add(kind);
  }
  return [...kinds];
};

/**
 * The JSON-LD used by every public share listing. The same ItemList shape is
 * built from the first 50 links, so trending/new/search cannot drift.
 */
export const buildShareListCollectionPage = ({
  items,
  name,
  description,
  path,
  siteName,
  baseUrl,
}: {
  items: { id: string; name?: string; updatedAt?: string }[];
  name: string;
  description: string;
  path: string;
  siteName: string;
  baseUrl: string;
}) =>
  buildCollectionPage({
    name,
    description,
    path,
    siteName,
    baseUrl,
    mainEntity: buildItemList(
      items.slice(0, 50).map((item) => ({
        name: item.name?.trim() || item.id,
        path: `/share/${item.id}`,
        image: getShareThumbnailUrl(item.id, item.updatedAt),
      })),
      baseUrl,
    ),
  });

export const buildCollectionPage = ({
  name,
  description,
  path,
  siteName,
  baseUrl,
  datePublished,
  dateModified,
  image,
  mainEntity,
}: {
  name: string;
  description: string;
  path: string;
  siteName: string;
  baseUrl: string;
  datePublished?: string;
  dateModified?: string;
  image?: string;
  mainEntity?: Record<string, unknown>;
}) => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name,
  description,
  url: absoluteUrl(path, baseUrl),
  ...(datePublished ? { datePublished } : {}),
  ...(dateModified ? { dateModified } : {}),
  ...(image ? { image: absoluteUrl(image, baseUrl) } : {}),
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
