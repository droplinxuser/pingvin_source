import type { ModalsContextProps } from "@mantine/modals/lib/context";
import { FileMetaData } from "../types/File.type";

/**
 * The file preview modal pulls in markdown rendering and every preview type.
 * Load it only when a visitor actually opens a preview so the share page's
 * initial bundle stays small.
 */
export const openFilePreview = (
  shareId: string,
  file: FileMetaData,
  modals: ModalsContextProps,
  files?: FileMetaData[],
) => {
  void import("../components/share/modals/showFilePreviewModal").then(
    ({ default: showFilePreviewModal }) => {
      showFilePreviewModal(shareId, file, modals, files);
    },
  );
};
