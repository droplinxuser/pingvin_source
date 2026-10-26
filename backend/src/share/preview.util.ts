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

// A corrupt or unsupported first image should not leave a whole listing card
// blank; try a few alternatives before giving up.
export const MAX_PREVIEW_CANDIDATES = 5;

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

/**
 * Ordered thumbnail candidates. The first entry is exactly what
 * `findPreview` chooses for listings, so normal shares keep their current
 * image/video. If that source cannot be decoded, the caller can retry the next
 * image or video instead of serving a transparent placeholder.
 */
export function getPreviewCandidates(
  files?: { id: string; name: string }[],
): PreviewFile[] {
  const candidates: PreviewFile[] = [];
  let remaining = files ?? [];

  while (remaining.length > 0 && candidates.length < MAX_PREVIEW_CANDIDATES) {
    const selection = findPreview(remaining);
    if (!selection) break;
    candidates.push(selection.preview);
    remaining = remaining.filter((file) => file.id !== selection.preview.id);
  }

  return candidates;
}
