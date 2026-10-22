import { Box, Card, SimpleGrid, Text, useMantineTheme } from "@mantine/core";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import shareService from "../../services/share.service";
import { InlinePreviewKind } from "../../utils/mime.util";
import { FileMetaData } from "../../types/File.type";
import {
  MAX_INLINE_FILE_SIZE,
} from "../../utils/fileSize.util";
import { getBaseName } from "../../utils/file.util";
import {
  AudioPreview,
  FilePreviewContext,
  ImagePreview,
  VideoPreview,
} from "./FilePreview";

// Images are fully fetched by the browser as soon as they are rendered, so
// only reasonably small ones are embedded. Videos and audio stream on demand.
const getMediaFiles = (files?: FileMetaData[]) =>
  (files || [])
    .map((file) => ({
      file,
      kind: shareService.getInlinePreviewKind(file.name),
    }))
    .filter(
      (
        mediaFile,
      ): mediaFile is { file: FileMetaData; kind: InlinePreviewKind } =>
        mediaFile.kind != undefined &&
        (mediaFile.kind != "image" ||
          parseInt(mediaFile.file.size) <= MAX_INLINE_FILE_SIZE),
    );

const MediaPreviewCard = ({
  shareId,
  file,
  kind,
}: {
  shareId: string;
  file: FileMetaData;
  kind: InlinePreviewKind;
}) => {
  const [isNotSupported, setIsNotSupported] = useState(false);
  const theme = useMantineTheme();
  const fileName = getBaseName(file.name);

  return (
    <Card withBorder radius="md" p="sm">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 120,
          borderRadius: theme.radius.sm,
          overflow: "hidden",
          backgroundColor:
            theme.colorScheme == "dark"
              ? theme.colors.dark[8]
              : theme.colors.gray[2],
          "& img, & video": { maxHeight: "70vh" },
        }}
      >
        {isNotSupported ? (
          <Text size="xs" color="dimmed" align="center" p="md">
            <FormattedMessage id="share.modal.file-preview.error.not-supported.title" />
          </Text>
        ) : (
          <FilePreviewContext.Provider
            value={{
              shareId,
              fileId: file.id,
              mimeType: shareService.getFileMimeType(file.name),
              setIsNotSupported,
            }}
          >
            {kind == "image" ? (
              <ImagePreview />
            ) : kind == "video" ? (
              <VideoPreview />
            ) : (
              <AudioPreview />
            )}
          </FilePreviewContext.Provider>
        )}
      </Box>
      <Text size="sm" truncate title={fileName} mt="sm">
        {fileName}
      </Text>
    </Card>
  );
};

const MediaPreviewGallery = ({
  shareId,
  files,
}: {
  shareId: string;
  files?: FileMetaData[];
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
        />
      ))}
    </SimpleGrid>
  );
};

export default MediaPreviewGallery;
