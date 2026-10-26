import { getFileMimeType } from "src/utils/mime.util";

export type PreviewKind = "image" | "video";

export type PreviewFile = {
  id: string;
  kind: PreviewKind;
};

export type PreviewSelection = {
  preview: PreviewFile;
  hasVideo: boolean;
};

// Browsers cannot decode every video container. Prefer a playable video from
// the same share, then an image, so previews show a real frame instead of a
// black box. Shares with neither keep the first video as a fallback.
const PLAYABLE_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "f4v", "webm"]);

/**
 * Chooses the file that best represents a share in listings, cards and
 * social/OG metadata. This helper is shared by the trending cache and the
 * background thumbnail generator so the two can never disagree.
 */
export function findPreview(
  files?: { id: string; name: string }[],
): PreviewSelection | undefined {
  let firstMedia: PreviewFile | undefined;
  let firstImage: PreviewFile | undefined;
  let playableVideo: PreviewFile | undefined;
  let hasVideo = false;

  for (const file of files ?? []) {
    const mimeType = getFileMimeType(file.name, false);
    if (mimeType.startsWith("image/")) {
      if (!firstMedia) firstMedia = { id: file.id, kind: "image" };
      if (!firstImage) firstImage = { id: file.id, kind: "image" };
    } else if (mimeType.startsWith("video/")) {
      hasVideo = true;
      if (!firstMedia) firstMedia = { id: file.id, kind: "video" };
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!playableVideo && PLAYABLE_VIDEO_EXTENSIONS.has(extension))
        playableVideo = { id: file.id, kind: "video" };
    }
  }

  if (!firstMedia) return undefined;
  if (firstMedia.kind === "video") {
    return {
      preview: playableVideo ?? firstImage ?? firstMedia,
      hasVideo,
    };
  }
  return { preview: firstMedia, hasVideo };
}
