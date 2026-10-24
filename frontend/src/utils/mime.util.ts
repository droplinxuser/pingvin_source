import mime from "mime-types";
import { getBaseName } from "./file.util";

export type GalleryMediaKind = "image" | "video";

// Extensions that browsers can render but that the installed mime-db version
// misses or misclassifies.
const mimeTypeOverrides: Record<string, string> = {
  jfif: "image/jpeg",
  jfi: "image/jpeg",
  jif: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
  dib: "image/bmp",
  mov: "video/mp4",
  f4v: "video/mp4",
  m4v: "video/mp4",
  ogv: "video/ogg",
  ogm: "video/ogg",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  "3gpp2": "video/3gpp2",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  m2v: "video/mpeg",
  vob: "video/mpeg",
  m2ts: "video/mp2t",
  mts: "video/mp2t",
  ts: "video/mp2t",
  avi: "video/x-msvideo",
  divx: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  asf: "video/x-ms-asf",
  flv: "video/x-flv",
};

// Formats with reliable native rendering across current Chrome, Firefox,
// Safari and Edge. TIFF, HEIC, JPEG XL and JPEG 2000 are intentionally omitted
// because they are not natively rendered by all of those browsers.
const GALLERY_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "jfi",
  "jif",
  "pjpeg",
  "pjp",
  "png",
  "apng",
  "gif",
  "webp",
  "avif",
  "bmp",
  "dib",
  "ico",
  "svg",
]);

// The browser's own canPlayType() check filters these further, so Safari and
// Chromium only get containers they actually advertise.
const GALLERY_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "f4v",
  "webm",
  "ogv",
  "ogm",
  "mkv",
  "3gp",
  "3gpp",
  "3gpp2",
  "mpeg",
  "mpg",
  "m2v",
  "vob",
  "m2ts",
  "mts",
  "ts",
  "avi",
  "divx",
  "wmv",
  "asf",
  "flv",
]);

const videoSupport = new Map<string, boolean>();
const mimeTypeCache = new Map<string, string>();

const getFileExtension = (fileName: string) => {
  const baseName = getBaseName(fileName);
  const dot = baseName.lastIndexOf(".");
  return dot === -1 ? "" : baseName.slice(dot + 1).toLowerCase();
};

const canPlayVideo = (mimeType: string) => {
  if (!mimeType) return false;
  // Chrome advertises the Ogg container but not Theora, which is what .ogv
  // and .ogm files normally use. Probe the codec so they are only embedded
  // where the browser can actually play them.
  const probe =
    mimeType === "video/ogg" ? `video/ogg; codecs="theora"` : mimeType;
  const cached = videoSupport.get(probe);
  if (cached !== undefined) return cached;

  const supported =
    typeof document !== "undefined" &&
    !!document.createElement("video").canPlayType(probe);
  videoSupport.set(probe, supported);
  return supported;
};

export const getFileMimeType = (fileName: string) => {
  const extension = getFileExtension(fileName);
  const cached = mimeTypeCache.get(extension);
  if (cached !== undefined) return cached;

  const mimeType = mimeTypeOverrides[extension] || mime.lookup(extension) || "";
  mimeTypeCache.set(extension, mimeType);
  return mimeType;
};

export const getGalleryMediaKind = (
  fileName: string,
): GalleryMediaKind | undefined => {
  const extension = getFileExtension(fileName);
  if (GALLERY_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (
    GALLERY_VIDEO_EXTENSIONS.has(extension) &&
    canPlayVideo(getFileMimeType(fileName))
  )
    return "video";
  return undefined;
};

/**
 * Extension-only check used to reserve skeleton space before the client has
 * loaded the share. Video codec support is checked later by the real gallery.
 */
export const isLikelyGalleryMedia = (fileName: string) => {
  const extension = getFileExtension(fileName);
  return (
    GALLERY_IMAGE_EXTENSIONS.has(extension) ||
    GALLERY_VIDEO_EXTENSIONS.has(extension)
  );
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
