import {
  Box,
  Card,
  Center,
  SimpleGrid,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { TbPlayerPlay } from "react-icons/tb";
import { FileMetaData } from "../../types/File.type";
import { MAX_INLINE_FILE_SIZE } from "../../utils/fileSize.util";
import { getBaseName } from "../../utils/file.util";
import { getGalleryMediaKind } from "../../utils/mime.util";
import useTranslate from "../../hooks/useTranslate.hook";
import showFilePreviewModal from "./modals/showFilePreviewModal";

const MAX_GALLERY_ITEMS = 30;
const GALLERY_MEDIA_HEIGHT = 250;

const MediaPreviewGallery = ({
  shareId,
  files = [],
}: {
  shareId: string;
  files?: FileMetaData[];
}) => {
  const modals = useModals();
  const t = useTranslate();

  const mediaFiles = files
    .filter((file) => {
      const kind = getGalleryMediaKind(file.name);
      return (
        kind &&
        (kind !== "image" || parseInt(file.size) <= MAX_INLINE_FILE_SIZE)
      );
    })
    .slice(0, MAX_GALLERY_ITEMS);

  if (mediaFiles.length === 0) return null;

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
      {mediaFiles.map((file) => {
        const kind = getGalleryMediaKind(file.name);
        const name = getBaseName(file.name);
        const url = `/api/shares/${shareId}/files/${file.id}?download=false`;

        return (
          <Card key={file.id} withBorder radius="md" p="sm">
            <UnstyledButton
              onClick={() => showFilePreviewModal(shareId, file, modals)}
              aria-label={`${t("common.button.preview")}: ${name}`}
              title={name}
              sx={{
                display: "block",
                width: "100%",
                padding: 0,
                cursor: "pointer",
                color: "inherit",
                textAlign: "left",
              }}
            >
              <Box
                sx={(theme) => ({
                  position: "relative",
                  height: GALLERY_MEDIA_HEIGHT,
                  maxHeight: GALLERY_MEDIA_HEIGHT,
                  overflow: "hidden",
                  borderRadius: theme.radius.sm,
                  backgroundColor:
                    theme.colorScheme === "dark"
                      ? theme.colors.dark[8]
                      : theme.colors.gray[2],
                  "& img, & video": {
                    display: "block",
                    width: "100%",
                    height: "100%",
                    maxHeight: GALLERY_MEDIA_HEIGHT,
                    objectFit: "cover",
                    backgroundColor: "#000",
                  },
                })}
              >
                {kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <>
                    <video
                      src={`${url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      aria-hidden="true"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                    <Center
                      sx={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                      }}
                    >
                      <ThemeIcon
                        size={46}
                        radius="xl"
                        variant="filled"
                        sx={{
                          backgroundColor: "rgba(0, 0, 0, 0.55)",
                          color: "white",
                        }}
                      >
                        <TbPlayerPlay size={22} />
                      </ThemeIcon>
                    </Center>
                  </>
                )}
              </Box>
              <Text size="sm" truncate mt="sm">
                {name}
              </Text>
            </UnstyledButton>
          </Card>
        );
      })}
    </SimpleGrid>
  );
};

export default MediaPreviewGallery;
