import * as mime from "mime-types";

// QuickTime (.mov) files share the ISO base media file format with MP4, but
// browsers refuse inline playback when they are advertised as
// "video/quicktime", so inline requests advertise them as video/mp4 instead.
// Downloads keep the real MIME type.
export function getFileMimeType(fileName: string, isDownload: boolean) {
  const mimeType = mime?.lookup?.(fileName) || "application/octet-stream";
  return !isDownload && mimeType == "video/quicktime" ? "video/mp4" : mimeType;
}
