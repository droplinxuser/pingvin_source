import mime from "mime-types";

export type InlinePreviewKind = "image" | "video" | "audio";

// Extensions that browsers can render but that the installed mime-db version
// misses or misclassifies. Lookups use only the extension so folder names
// containing "/" cannot be mistaken for MIME types.
const mimeTypeOverrides: Record<string, string> = {
  jfif: "image/jpeg",
  jfi: "image/jpeg",
  jif: "image/jpeg",
  jxl: "image/jxl",
  j2k: "image/jp2",
  ogx: "video/ogg",
  ogm: "video/ogg",
  m2ts: "video/mp2t",
  mts: "video/mp2t",
  "3gpp2": "video/3gpp2",
};

const PREVIEW_TYPES = ["image/", "video/", "audio/"] as const;

const getFileExtension = (fileName: string) =>
  fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();

export const getFileMimeType = (fileName: string) =>
  mimeTypeOverrides[getFileExtension(fileName)] ||
  mime.lookup(getFileExtension(fileName)) ||
  "";

export const doesFileSupportPreview = (fileName: string) => {
  const mimeType = getFileMimeType(fileName);
  return (
    !!mimeType &&
    (PREVIEW_TYPES.some((type) => mimeType.startsWith(type)) ||
      mimeType.startsWith("text/") ||
      mimeType == "application/pdf")
  );
};

export const isShareTextFile = (fileName: string) =>
  getFileMimeType(fileName).startsWith("text/");

export const getInlinePreviewKind = (
  fileName: string,
): InlinePreviewKind | undefined => {
  const mimeType = getFileMimeType(fileName);
  return PREVIEW_TYPES.find((type) => mimeType.startsWith(type))?.slice(
    0,
    -1,
  ) as InlinePreviewKind | undefined;
};
