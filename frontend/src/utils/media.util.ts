import { FileMetaData } from "../types/File.type";
import { getBaseName } from "./file.util";
import { GalleryMediaKind, getGalleryMediaKind } from "./mime.util";

export type ShareMediaFile = {
  file: FileMetaData;
  kind: GalleryMediaKind;
};

/**
 * The images and videos rendered by the share gallery and used by its preview
 * navigation. Images lead the list; each group is alphabetical so the gallery,
 * the file list and the preview arrows always agree on the order.
 */
export const getShareMediaFiles = (
  files: FileMetaData[] = [],
): ShareMediaFile[] =>
  files
    .map((file) => ({ file, kind: getGalleryMediaKind(file.name) }))
    .filter((entry): entry is ShareMediaFile => !!entry.kind)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "image" ? -1 : 1;
      return getBaseName(a.file.name).localeCompare(
        getBaseName(b.file.name),
        undefined,
        { numeric: true },
      );
    });
