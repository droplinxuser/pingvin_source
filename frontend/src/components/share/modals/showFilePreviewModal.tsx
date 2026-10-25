import { ModalsContextProps } from "@mantine/modals/lib/context";
import { FileMetaData } from "../../../types/File.type";
import { getFileMimeType } from "../../../utils/mime.util";
import { getBaseName } from "../../../utils/file.util";
import FilePreview from "../FilePreview";

const showFilePreviewModal = (
  shareId: string,
  file: FileMetaData,
  modals: ModalsContextProps,
) => {
  const mimeType = getFileMimeType(file.name);
  return modals.openModal({
    size: "xl",
    centered: true,
    title: getBaseName(file.name),
    // Keep the dialog inside the viewport and let the preview itself fit the
    // remaining space instead of turning the whole modal into a scroll area.
    styles: {
      content: { overflow: "hidden" },
      body: { overflow: "hidden" },
    },
    children: (
      <FilePreview
        shareId={shareId}
        fileId={file.id}
        fileName={file.name}
        mimeType={mimeType}
      />
    ),
  });
};

export default showFilePreviewModal;
