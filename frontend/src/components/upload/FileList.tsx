import { ActionIcon, Table, Group } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { TbTrash, TbEdit, TbX } from "react-icons/tb";
import { GrUndo } from "react-icons/gr";
import { FileListItem, FileUpload } from "../../types/File.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import { getNormalizedFileName } from "../../utils/file.util";
import { isShareTextFile } from "../../utils/mime.util";
import UploadProgressIndicator from "./UploadProgressIndicator";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import { HoverTip } from "../core/HoverTip";
import showTextEditorModal from "./modals/showTextEditorModal";
import FileName from "../core/FileName";

const FileListRow = ({
  file,
  onRemove,
  onRestore,
  onEdit,
  onCancel,
}: {
  file: FileListItem;
  onRemove?: () => void;
  onRestore?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}) => {
  {
    const uploadable = "uploadingProgress" in file;
    const uploading = uploadable && file.uploadingProgress !== 0;
    // In-flight (not done, not failed): offer a cancel that aborts the upload.
    const inProgress =
      uploadable && file.uploadingProgress > 0 && file.uploadingProgress < 100;
    const removable = uploadable
      ? file.uploadingProgress <= 0
      : onRemove && !file.deleted;
    const restorable = onRestore && !uploadable && !!file.deleted;
    const deleted = !uploadable && !!file.deleted;

    const fileNameOrPath = getNormalizedFileName(file);
    const isTextFile = isShareTextFile(fileNameOrPath);
    const editable = isTextFile && uploadable && file.uploadingProgress === 0;

    const t = useTranslate();

    return (
      <tr
        style={{
          color: deleted ? "rgba(120, 120, 120, 0.5)" : "inherit",
          textDecoration: deleted ? "line-through" : "none",
        }}
      >
        <td style={{ maxWidth: 0 }}>
          <FileName name={fileNameOrPath} />
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {byteToHumanSizeString(+file.size)}
        </td>
        <td>
          <Group position="right" spacing="xs" noWrap>
            {editable && (
              <HoverTip label={t("common.button.edit")}>
                <ActionIcon
                  color="blue"
                  variant="light"
                  size={25}
                  onClick={onEdit}
                >
                  <TbEdit />
                </ActionIcon>
              </HoverTip>
            )}
            {removable && (
              <HoverTip
                label={
                  uploadable
                    ? t("upload.filelist.remove")
                    : t("common.button.delete")
                }
              >
                <ActionIcon
                  color="red"
                  variant="light"
                  size={25}
                  aria-label={
                    uploadable
                      ? t("upload.filelist.remove")
                      : t("common.button.delete")
                  }
                  onClick={onRemove}
                >
                  <TbTrash />
                </ActionIcon>
              </HoverTip>
            )}
            {uploading && (
              <UploadProgressIndicator progress={file.uploadingProgress} />
            )}
            {inProgress && onCancel && (
              <HoverTip label={t("upload.filelist.cancel")}>
                <ActionIcon
                  color="red"
                  variant="light"
                  size={25}
                  aria-label={t("upload.filelist.cancel")}
                  onClick={onCancel}
                >
                  <TbX />
                </ActionIcon>
              </HoverTip>
            )}
            {restorable && (
              <HoverTip label={t("common.button.undo")}>
                <ActionIcon
                  color="victoria"
                  variant="light"
                  size={25}
                  onClick={onRestore}
                >
                  <GrUndo />
                </ActionIcon>
              </HoverTip>
            )}
          </Group>
        </td>
      </tr>
    );
  }
};

const FileList = <T extends FileListItem = FileListItem>({
  files,
  setFiles,
  onCancel,
}: {
  files: T[];
  setFiles: (files: T[]) => void;
  onCancel?: (file: FileUpload) => void;
}) => {
  const modals = useModals();
  const remove = (index: number) => {
    const file = files[index];

    if ("uploadingProgress" in file) {
      files.splice(index, 1);
    } else {
      files[index] = { ...file, deleted: true };
    }

    setFiles([...files]);
  };

  const restore = (index: number) => {
    const file = files[index];

    if ("uploadingProgress" in file) {
      return;
    } else {
      files[index] = { ...file, deleted: false };
    }

    setFiles([...files]);
  };

  const edit = async (index: number) => {
    const originalFile = files[index] as unknown as File;
    const text = await originalFile.text();

    showTextEditorModal(index, files, setFiles, text, modals);
  };

  const rows = files.map((file, i) => (
    <FileListRow
      key={i}
      file={file}
      onRemove={() => remove(i)}
      onRestore={() => restore(i)}
      onEdit={() => edit(i)}
      onCancel={
        onCancel && "uploadingProgress" in file
          ? () => onCancel(file as FileUpload)
          : undefined
      }
    />
  ));

  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: "100%" }}>
            <FormattedMessage id="upload.filelist.name" />
          </th>
          <th>
            <FormattedMessage id="upload.filelist.size" />
          </th>
          <th></th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </Table>
  );
};

export default FileList;
