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
    title: getBaseName(file.name),
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
