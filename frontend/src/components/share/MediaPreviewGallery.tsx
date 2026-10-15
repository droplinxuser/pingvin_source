import {
  ActionIcon,
  Box,
  Card,
  Center,
  Group,
  SimpleGrid,
  Stack,
  Text,
  useMantineTheme,
} from "@mantine/core";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbDownload, TbExternalLink } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService, { InlinePreviewKind } from "../../services/share.service";
import { FileMetaData } from "../../types/File.type";
import {
  byteToHumanSizeString,
  MAX_INLINE_FILE_SIZE,
} from "../../utils/fileSize.util";
import { HoverTip } from "../core/HoverTip";
import {
  AudioPreview,
  FilePreviewContext,
  ImagePreview,
  VideoPreview,
} from "./FilePreview";

const renderFileName = (name: string) => {
  const separator = name.lastIndexOf("/");
  if (separator == -1) return name;
  return (
    <span>
      <span style={{ opacity: 0.5 }}>{name.slice(0, separator + 1)}</span>
      <span style={{ fontWeight: 600 }}>{name.slice(separator + 1)}</span>
    </span>
  );
};

// Images are fully fetched by the browser as soon as they are rendered, so
// they are only embedded when they are reasonably small. Videos and audio are
// streamed on demand (the file endpoint supports range requests), so they can
// be embedded regardless of their size.
type MediaFile = {
  file: FileMetaData;
  kind: InlinePreviewKind;
};

const getMediaFiles = (files?: FileMetaData[]): MediaFile[] =>
  (files || [])
    .map((file) => ({
      file,
      kind: shareService.getInlinePreviewKind(file.name),
    }))
    .filter(
      (mediaFile): mediaFile is MediaFile =>
        mediaFile.kind != undefined &&
        (mediaFile.kind != "image" ||
          parseInt(mediaFile.file.size) <= MAX_INLINE_FILE_SIZE),
    );

const useMediaFrameStyle = () => {
  const theme = useMantineTheme();
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    minHeight: 120,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    backgroundColor:
      theme.colorScheme == "dark" ? theme.colors.dark[8] : theme.colors.gray[2],
  };
};

const EmbeddedMedia = ({
  kind,
  shareId,
  fileId,
  mimeType,
  onError,
}: {
  kind: InlinePreviewKind;
  shareId: string;
  fileId: string;
  mimeType: string;
  onError: () => void;
}) => {
  const frameStyle = useMediaFrameStyle();

  // Reuse the preview components from the file preview modal so the playback
  // logic lives in a single place.
  const preview = (
    <FilePreviewContext.Provider
      value={{ shareId, fileId, mimeType, setIsNotSupported: onError }}
    >
      {kind == "image" ? (
        <ImagePreview />
      ) : kind == "video" ? (
        <VideoPreview />
      ) : (
        <AudioPreview />
      )}
    </FilePreviewContext.Provider>
  );

  if (kind == "audio")
    return <Box sx={{ ...frameStyle, padding: "1rem" }}>{preview}</Box>;

  return (
    <Box sx={{ ...frameStyle, "& img, & video": { maxHeight: "70vh" } }}>
      {preview}
    </Box>
  );
};

const MediaNotSupported = () => {
  const frameStyle = useMediaFrameStyle();
  return (
    <Center p="md" sx={{ ...frameStyle, minHeight: 150 }}>
      <Stack align="center" spacing={4}>
        <Text size="sm" weight={500}>
          <FormattedMessage id="share.modal.file-preview.error.not-supported.title" />
        </Text>
        <Text size="xs" color="dimmed" align="center">
          <FormattedMessage id="share.modal.file-preview.error.not-supported.description" />
        </Text>
      </Stack>
    </Center>
  );
};

const MediaPreviewCard = ({
  shareId,
  file,
  kind,
  recipientId,
}: {
  shareId: string;
  file: FileMetaData;
  kind: InlinePreviewKind;
  recipientId?: string;
}) => {
  const [isNotSupported, setIsNotSupported] = useState(false);
  const t = useTranslate();

  const fileUrl = `/api/shares/${shareId}/files/${file.id}?download=false`;

  return (
    <Card
      withBorder
      radius="md"
      p="sm"
      sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}
    >
      {isNotSupported ? (
        <MediaNotSupported />
      ) : (
        <EmbeddedMedia
          kind={kind}
          shareId={shareId}
          fileId={file.id}
          mimeType={shareService.getFileMimeType(file.name)}
          onError={() => setIsNotSupported(true)}
        />
      )}

      <Group position="apart" spacing="xs" mt="sm" noWrap>
        <Box sx={{ minWidth: 0 }}>
          <Text size="sm" truncate title={file.name}>
            {renderFileName(file.name)}
          </Text>
          <Text size="xs" color="dimmed">
            {byteToHumanSizeString(parseInt(file.size))}
          </Text>
        </Box>
        <Group spacing={4} noWrap>
          <HoverTip label={t("share.modal.file-preview.original_file")}>
            <ActionIcon
              component="a"
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              variant="light"
              color="blue"
              size={30}
              aria-label={t("share.modal.file-preview.original_file")}
            >
              <TbExternalLink />
            </ActionIcon>
          </HoverTip>
          <HoverTip label={t("common.button.download")}>
            <ActionIcon
              variant="light"
              color="cyan"
              size={30}
              aria-label={t("common.button.download")}
              onClick={() =>
                shareService.downloadFile(shareId, file.id, recipientId)
              }
            >
              <TbDownload />
            </ActionIcon>
          </HoverTip>
        </Group>
      </Group>
    </Card>
  );
};

const MediaPreviewGallery = ({
  shareId,
  files,
  recipientId,
}: {
  shareId: string;
  files?: FileMetaData[];
  recipientId?: string;
}) => {
  const mediaFiles = getMediaFiles(files);

  if (mediaFiles.length == 0) return null;

  return (
    <SimpleGrid
      mb="xl"
      cols={1}
      spacing="md"
      breakpoints={
        mediaFiles.length == 1
          ? []
          : [
              { minWidth: "sm", cols: Math.min(2, mediaFiles.length) },
              { minWidth: "lg", cols: Math.min(3, mediaFiles.length) },
            ]
      }
    >
      {mediaFiles.map(({ file, kind }) => (
        <MediaPreviewCard
          key={file.id}
          shareId={shareId}
          file={file}
          kind={kind}
          recipientId={recipientId}
        />
      ))}
    </SimpleGrid>
  );
};

export default MediaPreviewGallery;
