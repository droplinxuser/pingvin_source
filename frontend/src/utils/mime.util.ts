import mime from "mime-types";
import { getBaseName } from "./file.util";

export type GalleryMediaKind = "image" | "video";

// Extensions that browsers can render but that the installed mime-db version
// misses or misclassifies.
const mimeTypeOverrides: Record<string, string> = {
  jfif: "image/jpeg",
  jfi: "image/jpeg",
  jif: "image/jpeg",
  m4v: "video/mp4",
};

// Only formats with reliable native browser support are embedded. QuickTime,
// JPEG XL, JPEG 2000, Matroska, MPEG-TS and similar formats are intentionally
// excluded because they often end in the "preview not supported" notice.
const GALLERY_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "jfi",
  "jif",
  "png",
  "apng",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
]);

const GALLERY_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm"]);

const getFileExtension = (fileName: string) => {
  const baseName = getBaseName(fileName);
  const dot = baseName.lastIndexOf(".");
  return dot === -1 ? "" : baseName.slice(dot + 1).toLowerCase();
};

export const getFileMimeType = (fileName: string) => {
  const extension = getFileExtension(fileName);
  return mimeTypeOverrides[extension] || mime.lookup(extension) || "";
};

export const getGalleryMediaKind = (
  fileName: string,
): GalleryMediaKind | undefined => {
  const extension = getFileExtension(fileName);
  if (GALLERY_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (GALLERY_VIDEO_EXTENSIONS.has(extension)) return "video";
  return undefined;
};

export const doesFileSupportPreview = (fileName: string) => {
  const mimeType = getFileMimeType(fileName);
  return (
    !!getGalleryMediaKind(fileName) ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("text/") ||
    mimeType === "application/pdf"
  );
};

export const isShareTextFile = (fileName: string) =>
  getFileMimeType(fileName).startsWith("text/");
