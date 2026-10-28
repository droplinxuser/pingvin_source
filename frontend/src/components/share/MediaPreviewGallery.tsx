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
import { openFilePreview } from "../../utils/filePreview.util";
import { getShareMediaFiles, ShareMediaFile } from "../../utils/media.util";
import { supportsWebpPreview } from "../../utils/mime.util";
import useTranslate from "../../hooks/useTranslate.hook";
import LazyImage from "../core/LazyImage";
import LazyVideo from "../core/LazyVideo";

const MAX_GALLERY_ITEMS = 100;
// Long media shares are revealed in small batches. Only the first batch mounts
// media elements up front; the rest arrive as the visitor approaches them, with
// a skeleton card reserving the next row.
const GALLERY_BATCH_SIZE = 12;
const GALLERY_MEDIA_HEIGHT = 250;
// A single media card would otherwise stretch across the whole content column
// as a very wide 250px strip. Cap it at a nearly square canvas so the preview
// shows most of the image/video without dominating the page.
const SINGLE_GALLERY_MAX_WIDTH = 520;

const GalleryMediaCard = ({
  shareId,
  entry,
  onOpen,
  single,
  posterUrl,
  priority,
}: {
  shareId: string;
  entry: ShareMediaFile;
  onOpen: (file: FileMetaData) => void;
  single: boolean;
  posterUrl?: string;
  priority?: boolean;
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
    <Card
      data-testid="media-preview-item"
      withBorder
      radius="md"
      p="sm"
      sx={
        single
          ? {
              width: "100%",
              maxWidth: SINGLE_GALLERY_MAX_WIDTH,
              marginInline: "auto",
            }
          : undefined
      }
    >
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
            ...(single
              ? { aspectRatio: "1 / 1", width: "100%" }
              : {
                  height: GALLERY_MEDIA_HEIGHT,
                  maxHeight: GALLERY_MEDIA_HEIGHT,
                }),
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
              maxHeight: single ? "100%" : GALLERY_MEDIA_HEIGHT,
              // A single preview keeps the whole frame visible inside the
              // square card; multiple cards stay edge-to-edge thumbnails.
              objectFit: single ? "contain" : "cover",
              backgroundColor: "#000",
            },
          })}
        >
          {kind === "image" ? (
            <LazyImage
              src={imageUrl}
              alt={name}
              loading={priority ? "eager" : undefined}
              fetchPriority={priority ? "high" : undefined}
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
                poster={posterUrl}
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
                  // A poster is a real first paint: show it immediately
                  // instead of waiting for the video's first frame, which
                  // would otherwise become a late LCP candidate.
                  opacity: posterUrl || videoLoaded ? 1 : 0,
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
  posterUrl,
}: {
  shareId: string;
  files?: FileMetaData[];
  /** Share thumbnail shown as the first video poster / LCP placeholder. */
  posterUrl?: string;
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
  const single = galleryItems.length === 1;

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
      {visibleItems.map((entry, index) => (
        <GalleryMediaCard
          key={entry.file.id}
          shareId={shareId}
          entry={entry}
          single={single}
          posterUrl={index === 0 ? posterUrl : undefined}
          priority={index === 0}
          onOpen={(file) =>
            openFilePreview(shareId, file, modals, previewFiles)
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
            <Skeleton height={20} width="60%" mt="sm" />
          </Card>
        </Box>
      )}
    </SimpleGrid>
  );
};

export const MediaPreviewGallerySkeleton = ({
  count,
  thumbnailUrl,
}: {
  count: number;
  thumbnailUrl?: string;
}) => {
  if (count <= 0) return null;
  // Match the first gallery batch so the initial placeholder is not heavier
  // than the content it replaces. The gallery reveals the rest lazily.
  const itemCount = Math.min(count, GALLERY_BATCH_SIZE);
  const single = itemCount === 1;

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
        <Card
          key={index}
          withBorder
          radius="md"
          p="sm"
          sx={
            single
              ? {
                  width: "100%",
                  maxWidth: SINGLE_GALLERY_MAX_WIDTH,
                  marginInline: "auto",
                }
              : undefined
          }
        >
          {thumbnailUrl && index === 0 ? (
            // The share thumbnail is already in the SEO payload. Rendering it
            // in the server HTML gives the page a discoverable LCP image
            // instead of waiting for hydration, the share request and then the
            // first video frame.
            <img
              src={thumbnailUrl}
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
              style={{
                display: "block",
                width: "100%",
                height: single ? "auto" : GALLERY_MEDIA_HEIGHT,
                ...(single ? { aspectRatio: "1 / 1" } : {}),
                objectFit: single ? "contain" : "cover",
                backgroundColor: "#000",
                borderRadius: "0.25rem",
              }}
            />
          ) : single ? (
            <Skeleton
              radius="sm"
              sx={{ aspectRatio: "1 / 1", height: "auto", width: "100%" }}
            />
          ) : (
            <Skeleton height={GALLERY_MEDIA_HEIGHT} radius="sm" />
          )}
          <Skeleton height={20} width="60%" mt="sm" />
        </Card>
      ))}
    </SimpleGrid>
  );
};

export default MediaPreviewGallery;
