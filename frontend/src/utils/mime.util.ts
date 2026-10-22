import mime from "mime-types";

export type InlinePreviewKind = "image" | "video" | "audio";

const getFileExtension = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex === -1
    ? ""
    : fileName.slice(lastDotIndex + 1).toLowerCase();
};

// Media extensions that browsers can render but that the installed mime-db
// version misses or misclassifies. Kept independent of the mime-db version.
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
  mov: "video/quicktime",
  qt: "video/quicktime",
};

export const getFileMimeType = (fileName: string) => {
  const extension = getFileExtension(fileName);
  // Use the extension instead of the full name: mime.contentType() mistakes
  // names containing "/" (folder uploads) for MIME types and returns them as-is.
  return mimeTypeOverrides[extension] || mime.lookup(extension) || "";
};

export const doesFileSupportPreview = (fileName: string) => {
  const mimeType = getFileMimeType(fileName);
  return (
    !!mimeType &&
    (mimeType.startsWith("video/") ||
      mimeType.startsWith("image/") ||
      mimeType.startsWith("audio/") ||
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
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
};
