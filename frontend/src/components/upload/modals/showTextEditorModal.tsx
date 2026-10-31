import { ModalsContextProps } from "@mantine/modals/lib/context";
import { translateOutsideContext } from "../../../hooks/useTranslate.hook";
import { FileListItem, FileUpload } from "../../../types/File.type";
import { getFileMimeType } from "../../../utils/mime.util";
import TextEditor from "../TextEditor";

const showTextEditorModal = <T extends FileListItem>(
  index: number,
  files: T[],
  setFiles: (files: T[]) => void,
  text: string,
  modals: ModalsContextProps,
) => {
  const t = translateOutsideContext();
  const originalFile = files[index] as unknown as File;
  const mimeType = getFileMimeType(originalFile.name) || "text/plain";

  // Assigned right after openModal returns; the handlers below only run once
  // the modal is on screen, so there is no race with this reference.
  let modalId = "";
  const close = () => modals.closeModal(modalId);

  modalId = modals.openModal({
    title: t("upload.text.edit.title", { name: originalFile.name }),
    // Match the page container so the editor lines up with the rest of the site.
    size: 960,
    children: (
      <TextEditor
        initialText={text}
        onCancel={close}
        fieldLabel={t("upload.text.field")}
        onSave={(newText) => {
          const newFile = new File([newText], originalFile.name, {
            type: mimeType,
          });

          const fileUpload = newFile as FileUpload;
          fileUpload.uploadingProgress = 0;

          const updatedFiles = [...files];
          updatedFiles[index] = fileUpload as unknown as T;
          setFiles(updatedFiles);
          close();
        }}
      />
    ),
  });
};

export default showTextEditorModal;
