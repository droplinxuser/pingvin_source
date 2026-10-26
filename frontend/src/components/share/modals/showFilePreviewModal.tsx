import { ActionIcon, Box, Group, Stack, Text } from "@mantine/core";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { useCallback, useEffect, useState } from "react";
import { TbChevronLeft, TbChevronRight } from "react-icons/tb";
import useTranslate, {
  translateOutsideContext,
} from "../../../hooks/useTranslate.hook";
import { FileMetaData } from "../../../types/File.type";
import { getBaseName } from "../../../utils/file.util";
import { getFileMimeType } from "../../../utils/mime.util";
import FilePreview from "../FilePreview";

const navButtonStyle = {
  pointerEvents: "auto",
  backgroundColor: "rgba(0, 0, 0, 0.55)",
  color: "white",
  backdropFilter: "blur(4px)",
  "&:hover": {
    backgroundColor: "rgba(0, 0, 0, 0.78)",
  },
} as const;

const FilePreviewDialog = ({
  shareId,
  files,
  initialFileId,
}: {
  shareId: string;
  files: FileMetaData[];
  initialFileId: string;
}) => {
  const t = useTranslate();
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      files.findIndex((file) => file.id === initialFileId),
    ),
  );
  const activeFile = files[index] ?? files[0];
  const canNavigate = files.length > 1;
  const name = activeFile ? getBaseName(activeFile.name) : "";

  const move = useCallback(
    (offset: number) => {
      if (!canNavigate) return;
      setIndex((current) => (current + offset + files.length) % files.length);
    },
    [canNavigate, files.length],
  );

  useEffect(() => {
    if (!canNavigate) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (
        target?.closest?.(
          "input, textarea, [contenteditable='true'], video, audio",
        )
      )
        return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNavigate, move]);

  if (!activeFile) return null;

  return (
    <Stack spacing="sm">
      <Group position="apart" align="center" spacing="sm" noWrap>
        <Text size="sm" weight={700} lineClamp={1} title={name}>
          {name}
        </Text>
        {canNavigate && (
          <Text
            size="xs"
            color="dimmed"
            aria-live="polite"
            sx={{ whiteSpace: "nowrap" }}
          >
            {t("share.modal.file-preview.custom.position", {
              current: index + 1,
              total: files.length,
            })}
          </Text>
        )}
      </Group>

      <Box sx={{ position: "relative" }}>
        <FilePreview
          key={activeFile.id}
          shareId={shareId}
          fileId={activeFile.id}
          fileName={activeFile.name}
          mimeType={getFileMimeType(activeFile.name)}
        />
        {canNavigate && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 8,
              pointerEvents: "none",
            }}
          >
            <ActionIcon
              onClick={() => move(-1)}
              aria-label={t("share.modal.file-preview.custom.previous")}
              title={t("share.modal.file-preview.custom.previous")}
              size="lg"
              radius="xl"
              sx={navButtonStyle}
            >
              <TbChevronLeft size={22} />
            </ActionIcon>
            <ActionIcon
              onClick={() => move(1)}
              aria-label={t("share.modal.file-preview.custom.next")}
              title={t("share.modal.file-preview.custom.next")}
              size="lg"
              radius="xl"
              sx={navButtonStyle}
            >
              <TbChevronRight size={22} />
            </ActionIcon>
          </Box>
        )}
      </Box>
    </Stack>
  );
};

const showFilePreviewModal = (
  shareId: string,
  file: FileMetaData,
  modals: ModalsContextProps,
  files?: FileMetaData[],
) => {
  const sequence =
    files && files.some((item) => item.id === file.id) ? files : [file];
  const t = translateOutsideContext();

  return modals.openModal({
    size: "xl",
    centered: true,
    title: t("common.button.preview"),
    // Keep the dialog inside the viewport and let the preview itself fit the
    // remaining space instead of turning the whole modal into a scroll area.
    styles: {
      content: { overflow: "hidden" },
      body: { overflow: "hidden" },
    },
    children: (
      <FilePreviewDialog
        shareId={shareId}
        files={sequence}
        initialFileId={file.id}
      />
    ),
  });
};

export default showFilePreviewModal;
