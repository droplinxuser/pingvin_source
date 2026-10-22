import { Box, Card, SimpleGrid, Text } from "@mantine/core";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { FileMetaData } from "../../types/File.type";
import { MAX_INLINE_FILE_SIZE } from "../../utils/fileSize.util";
import { getBaseName } from "../../utils/file.util";
import {
  getFileMimeType,
  getInlinePreviewKind,
  InlinePreviewKind,
} from "../../utils/mime.util";
import {
  AudioPreview,
  FilePreviewContext,
  ImagePreview,
  VideoPreview,
} from "./FilePreview";

// Images are fully fetched by the browser as soon as they are rendered, so
// only reasonably small ones are embedded. Videos and audio stream on demand.
const getMediaFiles = (files: FileMetaData[] = []) =>
  files.flatMap((file) => {
    const kind = getInlinePreviewKind(file.name);
    return kind &&
      (kind != "image" || parseInt(file.size) <= MAX_INLINE_FILE_SIZE)
      ? [{ file, kind }]
      : [];
  });

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
  const fileName = getBaseName(file.name);

  return (
    <Card withBorder radius="md" p="sm">
      <Box
        sx={(theme) => ({
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
        })}
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
              mimeType: getFileMimeType(file.name),
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
      breakpoints={[
        { minWidth: "sm", cols: Math.min(2, mediaFiles.length) },
        { minWidth: "lg", cols: Math.min(3, mediaFiles.length) },
      ]}
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
