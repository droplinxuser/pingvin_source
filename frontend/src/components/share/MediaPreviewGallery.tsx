import {
  Box,
  Card,
  Center,
  SimpleGrid,
  Skeleton,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useEffect, useMemo, useRef, useState } from "react";
import { TbPlayerPlay } from "react-icons/tb";
import { FileMetaData } from "../../types/File.type";
import { getBaseName, getShareFileUrl } from "../../utils/file.util";
import { getShareMediaFiles, ShareMediaFile } from "../../utils/media.util";
import { supportsWebpPreview } from "../../utils/mime.util";
import useTranslate from "../../hooks/useTranslate.hook";
import LazyImage from "../core/LazyImage";
import LazyVideo from "../core/LazyVideo";
import showFilePreviewModal from "./modals/showFilePreviewModal";

const MAX_GALLERY_ITEMS = 100;
// Long media shares are revealed in small batches. Only the first batch mounts
// media elements up front; the rest arrive as the visitor approaches them, with
// a skeleton card reserving the next row.
const GALLERY_BATCH_SIZE = 12;
const GALLERY_MEDIA_HEIGHT = 250;

const GalleryMediaCard = ({
  shareId,
  entry,
  onOpen,
}: {
  shareId: string;
  entry: ShareMediaFile;
  onOpen: (file: FileMetaData) => void;
}) => {
  const { file, kind } = entry;
  const t = useTranslate();
  const name = getBaseName(file.name);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const url = getShareFileUrl(shareId, file.id, { download: false });
  const imageUrl = supportsWebpPreview(file.name)
    ? getShareFileUrl(shareId, file.id, {
        download: false,
        webp: true,
      })
    : url;

  return (
    <Card data-testid="media-preview-item" withBorder radius="md" p="sm">
      <UnstyledButton
        onClick={() => onOpen(file)}
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
            <LazyImage
              src={imageUrl}
              alt={name}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <>
              {!videoLoaded && !videoFailed && (
                <Skeleton
                  height="100%"
                  radius={0}
                  aria-hidden
                  sx={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 0,
                    pointerEvents: "none",
                  }}
                />
              )}
              <LazyVideo
                src={`${url}#t=0.1`}
                muted
                playsInline
                aria-hidden="true"
                onLoadedData={() => setVideoLoaded(true)}
                onError={(event) => {
                  setVideoFailed(true);
                  event.currentTarget.style.display = "none";
                }}
                style={{
                  position: "relative",
                  zIndex: 1,
                  opacity: videoLoaded ? 1 : 0,
                  transition: "opacity 160ms ease",
                }}
              />
              <Center
                sx={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
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
};

const MediaPreviewGallery = ({
  shareId,
  files = [],
}: {
  shareId: string;
  files?: FileMetaData[];
}) => {
  const modals = useModals();
  const t = useTranslate();
  const mediaFiles = useMemo(() => getShareMediaFiles(files), [files]);
  const galleryItems = mediaFiles.slice(0, MAX_GALLERY_ITEMS);
  const [visibleCount, setVisibleCount] = useState(GALLERY_BATCH_SIZE);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(GALLERY_BATCH_SIZE);
  }, [galleryItems.length]);

  useEffect(() => {
    if (visibleCount >= galleryItems.length) return;

    const element = moreRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(galleryItems.length);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleCount((count) =>
          Math.min(count + GALLERY_BATCH_SIZE, galleryItems.length),
        );
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [galleryItems.length, visibleCount]);

  if (mediaFiles.length === 0) return null;

  const visibleItems = galleryItems.slice(0, visibleCount);
  const previewFiles = mediaFiles.map((entry) => entry.file);

  return (
    <SimpleGrid
      data-testid="media-preview-gallery"
      mb="md"
      cols={1}
      spacing="md"
      breakpoints={[
        { minWidth: "sm", cols: Math.min(2, galleryItems.length) },
        { minWidth: "lg", cols: Math.min(3, galleryItems.length) },
      ]}
    >
      {visibleItems.map((entry) => (
        <GalleryMediaCard
          key={entry.file.id}
          shareId={shareId}
          entry={entry}
          onOpen={(file) =>
            showFilePreviewModal(shareId, file, modals, previewFiles)
          }
        />
      ))}
      {visibleCount < galleryItems.length && (
        <Box
          ref={moreRef}
          data-testid="media-preview-more"
          aria-hidden
          sx={{ minWidth: 0 }}
        >
          <Card withBorder radius="md" p="sm">
            <Skeleton height={GALLERY_MEDIA_HEIGHT} radius="sm" />
            <Skeleton height={12} width="60%" mt="sm" />
          </Card>
        </Box>
      )}
    </SimpleGrid>
  );
};

export const MediaPreviewGallerySkeleton = ({ count }: { count: number }) => {
  if (count <= 0) return null;
  // Match the first gallery batch so the initial placeholder is not heavier
  // than the content it replaces. The gallery reveals the rest lazily.
  const itemCount = Math.min(count, GALLERY_BATCH_SIZE);

  return (
    <SimpleGrid
      mb="md"
      cols={1}
      spacing="md"
      breakpoints={[
        { minWidth: "sm", cols: Math.min(2, itemCount) },
        { minWidth: "lg", cols: Math.min(3, itemCount) },
      ]}
    >
      {Array.from({ length: itemCount }, (_, index) => (
        <Card key={index} withBorder radius="md" p="sm">
          <Skeleton height={GALLERY_MEDIA_HEIGHT} radius="sm" />
          <Skeleton height={12} width="60%" mt="sm" />
        </Card>
      ))}
    </SimpleGrid>
  );
};

export default MediaPreviewGallery;
