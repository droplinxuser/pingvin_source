import { Box, Card, SimpleGrid, Text } from "@mantine/core";
import { FileMetaData } from "../../types/File.type";
import { MAX_INLINE_FILE_SIZE } from "../../utils/fileSize.util";
import { getBaseName } from "../../utils/file.util";
import { getFileMimeType, getInlinePreviewKind } from "../../utils/mime.util";
import FilePreview from "./FilePreview";

// Images are fully fetched by the browser as soon as they are rendered, so
// only reasonably small ones are embedded. Videos and audio stream on demand.
const MAX_GALLERY_ITEMS = 6;

const MediaPreviewGallery = ({
  shareId,
  files = [],
}: {
  shareId: string;
  files?: FileMetaData[];
}) => {
  const mediaFiles = files
    .filter((file) => {
      const kind = getInlinePreviewKind(file.name);
      return (
        kind && (kind != "image" || parseInt(file.size) <= MAX_INLINE_FILE_SIZE)
      );
    })
    .slice(0, MAX_GALLERY_ITEMS);

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
      {mediaFiles.map((file) => (
        <Card key={file.id} withBorder radius="md" p="sm">
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
            <FilePreview
              shareId={shareId}
              fileId={file.id}
              mimeType={getFileMimeType(file.name)}
              showOriginalFileButton={false}
            />
          </Box>
          <Text size="sm" truncate title={getBaseName(file.name)} mt="sm">
            {getBaseName(file.name)}
          </Text>
        </Card>
      ))}
    </SimpleGrid>
  );
};

export default MediaPreviewGallery;
