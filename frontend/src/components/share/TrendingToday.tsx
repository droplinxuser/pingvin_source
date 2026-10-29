import {
  Anchor,
  Box,
  Container,
  createStyles,
  Group,
  Skeleton,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  TbCalendar,
  TbDatabase,
  TbEye,
  TbFile,
  TbFiles,
  TbPhoto,
  TbPlayerPlay,
} from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { TrendingShare } from "../../types/share.type";
import {
  getShareThumbnailUrl,
  handleShareThumbnailError,
} from "../../utils/file.util";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import LazyImage from "../core/LazyImage";
import RelativeTime from "../core/RelativeTime";

// Long listings (the newest 200 shares) are revealed in viewport-sized
// batches. Only the first batch is rendered up front, so the browser never
// creates hundreds of cards, observers and media elements at once.
const CARD_BATCH_SIZE = 24;

const useStyles = createStyles((theme) => {
  const border =
    theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2];

  return {
    root: {
      marginTop: theme.spacing.xl,
      marginBottom: theme.spacing.xl,
    },

    heading: {
      fontSize: theme.fontSizes.lg,
      fontWeight: 800,
      lineHeight: 1.2,
    },

    headingLink: {
      color: "inherit",
      textDecoration: "none",

      "&:hover": {
        textDecoration: "underline",
      },
    },

    subheading: {
      color:
        theme.colorScheme === "dark"
          ? theme.colors.dark[2]
          : theme.colors.gray[6],
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: theme.spacing.md,

      [theme.fn.smallerThan("lg")]: {
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      },

      [theme.fn.smallerThan("sm")]: {
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      },

      [theme.fn.smallerThan("xs")]: {
        gridTemplateColumns: "minmax(0, 1fr)",
      },
    },

    card: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      width: "100%",
      minHeight: 210,
      overflow: "hidden",
      border: `1px solid ${border}`,
      borderRadius: theme.radius.md,
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[8]
          : theme.colors.gray[2],
      color: "white",
      textAlign: "left",
      transition: "transform 120ms ease, border-color 120ms ease",

      "&:hover": {
        transform: "translateY(-2px)",
        borderColor:
          theme.colors[theme.primaryColor][
            theme.colorScheme === "dark" ? 5 : 4
          ],
      },

      "&:focus-visible": {
        outline: `2px solid ${
          theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 5 : 4]
        }`,
        outlineOffset: 2,
      },

      // The preview stays lightly blurred so the details remain readable;
      // hovering reveals the full image.
      "&:hover img, &:hover video": {
        filter: "blur(0px) brightness(1)",
        transform: "scale(1.02)",
      },
    },

    media: {
      position: "absolute",
      inset: 0,
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      backgroundColor: "#000",
      filter: "blur(6px) brightness(0.5)",
      transform: "scale(1.12)",
      transition: "filter 120ms ease, transform 120ms ease",
      pointerEvents: "none",
    },

    mediaSoft: {
      filter: "blur(4px) brightness(0.5)",
    },

    mediaSoftest: {
      filter: "blur(2px) brightness(0.5)",
    },

    // File-only shares have no image to blur; list a few file names instead so
    // the card still reads as a share. Falls back to a document glyph when the
    // name list is unavailable.
    fileFallback: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "rgba(255, 255, 255, 0.32)",
      pointerEvents: "none",
    },

    fileList: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: 6,
      // Leave room for the badges at the top and the share body at the bottom.
      padding: "42px 12px 76px",
      overflow: "hidden",
      pointerEvents: "none",
      backgroundColor:
        theme.colorScheme === "dark" ? theme.colors.dark[7] : "#1f2937",
      color: "white",
    },

    fileRow: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: "rgba(255, 255, 255, 0.9)",
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    fileName: {
      minWidth: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },

    // File-only cards on the search page: a flat surface with the title and
    // description centered, instead of the file-name list.
    fileCentered: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      backgroundColor:
        theme.colorScheme === "dark" ? theme.colors.dark[7] : "#1f2937",
    },

    centeredBody: {
      position: "absolute",
      inset: 0,
      zIndex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: 8,
      // Leave room for the badges at the top.
      padding: "44px 16px 16px",
    },

    centeredName: {
      color: "white",
      fontSize: theme.fontSizes.md,
      fontWeight: 800,
      lineHeight: 1.3,
      overflowWrap: "anywhere",
      textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)",
    },

    centeredDescription: {
      color: "rgba(255, 255, 255, 0.8)",
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.45,
      overflowWrap: "anywhere",
    },

    centeredMeta: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
      columnGap: theme.spacing.sm,
      rowGap: 4,
      marginTop: 2,
      color: "rgba(255, 255, 255, 0.72)",
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    scrim: {
      position: "absolute",
      inset: 0,
      background:
        "linear-gradient(180deg, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.42) 38%, rgba(0, 0, 0, 0.9) 100%)",
      pointerEvents: "none",
    },

    topRow: {
      position: "absolute",
      top: 8,
      right: 8,
      left: 8,
      zIndex: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 6,
      pointerEvents: "none",
    },

    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "4px 8px",
      borderRadius: theme.radius.sm,
      backgroundColor: "rgba(0, 0, 0, 0.68)",
      color: "white",
      fontSize: theme.fontSizes.xs,
      fontWeight: 700,
      lineHeight: 1,
    },

    mediaBadge: {
      marginRight: "auto",
    },

    body: {
      position: "relative",
      zIndex: 1,
      width: "100%",
      padding: theme.spacing.sm,
    },

    name: {
      color: "white",
      fontSize: theme.fontSizes.sm,
      fontWeight: 800,
      lineHeight: 1.3,
      overflowWrap: "anywhere",
      textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)",
    },

    description: {
      marginTop: 3,
      color: "rgba(255, 255, 255, 0.78)",
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.35,
      overflowWrap: "anywhere",
    },

    meta: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: theme.spacing.sm,
      rowGap: 4,
      marginTop: theme.spacing.sm,
      color: "rgba(255, 255, 255, 0.72)",
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    metaItem: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      whiteSpace: "nowrap",
    },
  };
});

const TrendingToday = ({
  initialItems,
  embedded = false,
  limit = 12,
  previewBlur = 4,
  children,
  title: titleOverride,
  description: descriptionOverride,
  loadingText: loadingOverride,
  emptyText: emptyOverride,
  loadItems = shareService.getTrending,
  showMediaTypeBadge = false,
  fileOnlyLayout = "files",
}: {
  initialItems?: TrendingShare[];
  embedded?: boolean;
  limit?: number;
  previewBlur?: 2 | 4 | 6;
  children?: ReactNode;
  title?: string;
  description?: string;
  loadingText?: string;
  emptyText?: string;
  loadItems?: (limit: number) => Promise<TrendingShare[]>;
  showMediaTypeBadge?: boolean;
  // How a file-only card (no image/video preview) renders its preview area:
  // "files" lists a few file names, "centered" shows a flat surface so the
  // title and description can sit in the middle of the card.
  fileOnlyLayout?: "files" | "centered";
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const title = titleOverride ?? t("trending.custom.title");
  const description = descriptionOverride ?? t("trending.custom.description");
  const loadingText = loadingOverride ?? t("trending.custom.loading");
  const emptyText = emptyOverride ?? t("trending.custom.empty");
  const mediaClassName = `${classes.media}${
    previewBlur === 4
      ? ` ${classes.mediaSoft}`
      : previewBlur === 2
        ? ` ${classes.mediaSoftest}`
        : ""
  }`;
  const [items, setItems] = useState<TrendingShare[]>(initialItems ?? []);
  const [isLoading, setIsLoading] = useState(!initialItems?.length);
  const [shouldLoad, setShouldLoad] = useState(!!initialItems?.length);
  const [visibleCount, setVisibleCount] = useState(CARD_BATCH_SIZE);
  const sectionRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialItems?.length) return;
    setItems(initialItems);
    setIsLoading(false);
    setShouldLoad(true);
  }, [initialItems]);

  // Trending is below the main content on the share and 404 pages. Wait until
  // it is close to the viewport before asking the API, so a new visitor's first
  // paint and share request are not competing with this ranking request.
  useEffect(() => {
    if (shouldLoad) return;
    const element = sectionRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Also load when the widget was scrolled past in a single jump. The
        // large top margin keeps an element that jumped above the viewport
        // inside the observed root, so the observer still fires.
        if (!entry.isIntersecting && entry.boundingClientRect.top >= 0) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "1000000px 400px 400px 400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || items.length > 0) return;

    // An SSR timeout or an empty edge response must not lock the page into the
    // empty state. Retry in the browser and only show "empty" once that
    // request has completed.
    let cancelled = false;
    setIsLoading(true);
    loadItems(limit)
      .then((trending) => {
        if (!cancelled) setItems(trending);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoad, limit, loadItems]);

  const showPlaceholder = isLoading || !shouldLoad;

  // A new result set always starts with one batch; changing the page/listing
  // must not inherit the number of cards revealed on the previous list.
  useEffect(() => {
    setVisibleCount(CARD_BATCH_SIZE);
  }, [items, limit]);

  useEffect(() => {
    if (showPlaceholder || visibleCount >= items.length) return;

    const element = moreRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(items.length);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleCount((count) =>
          Math.min(count + CARD_BATCH_SIZE, items.length),
        );
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length, showPlaceholder, visibleCount]);

  const visibleItems = items.slice(0, visibleCount);

  if (!showPlaceholder && items.length === 0 && !embedded) return null;

  const content = (
    <>
      <Group position="apart" align="baseline" mb="md">
        {embedded ? (
          <Title order={1} id="trending-title" className={classes.heading}>
            {title}
          </Title>
        ) : (
          <Title order={2} id="trending-title" className={classes.heading}>
            <Anchor
              component={Link}
              href="/trending"
              className={classes.headingLink}
            >
              {title}
            </Anchor>
          </Title>
        )}
        <Text className={classes.subheading}>
          {showPlaceholder ? loadingText : description}
        </Text>
      </Group>

      {children}

      {!showPlaceholder && items.length === 0 ? (
        <Text className={classes.subheading} mt="xs">
          {emptyText}
        </Text>
      ) : showPlaceholder ? (
        <div className={classes.grid} aria-hidden>
          {Array.from(
            { length: Math.min(limit, CARD_BATCH_SIZE) },
            (_, index) => (
              <Box
                key={index}
                className={classes.card}
                sx={{ pointerEvents: "none" }}
              >
                <Skeleton height={210} radius={0} />
              </Box>
            ),
          )}
        </div>
      ) : (
        <div className={classes.grid} data-testid="trending-grid">
          {visibleItems.map((item, index) => {
            const name = item.name || item.id;
            const views = item.views.toLocaleString(intl.locale);
            const hasMedia = !!item.previewFileId;
            const thumbnailUrl = hasMedia
              ? getShareThumbnailUrl(item.id, item.updatedAt)
              : undefined;
            const description = item.description?.trim();
            const hasVideo =
              item.previewKind === "video" || item.hasVideo === true;
            const showMediaBadge =
              hasMedia && (hasVideo || showMediaTypeBadge);
            const centeredFileCard =
              fileOnlyLayout === "centered" && !hasMedia;
            const metaItems = (
              <>
                {!!item.fileCount && (
                  <Box component="span" className={classes.metaItem}>
                    <TbFiles size={14} aria-hidden />
                    {t("trending.custom.files", {
                      count: item.fileCount,
                    })}
                  </Box>
                )}
                {!!item.size && (
                  <Box component="span" className={classes.metaItem}>
                    <TbDatabase size={14} aria-hidden />
                    {byteToHumanSizeString(item.size)}
                  </Box>
                )}
                {!!item.createdAt && (
                  <Box component="span" className={classes.metaItem}>
                    <TbCalendar size={14} aria-hidden />
                    <FormattedMessage
                      id="trending.custom.uploaded"
                      values={{
                        date: <RelativeTime date={item.createdAt} />,
                      }}
                    />
                  </Box>
                )}
              </>
            );

            return (
              <UnstyledButton
                key={item.id}
                component={Link}
                href={`/share/${item.id}`}
                className={classes.card}
                title={name}
              >
                {hasMedia ? (
                  <LazyImage
                    className={mediaClassName}
                    src={thumbnailUrl}
                    alt=""
                    loading={index < 4 ? "eager" : undefined}
                    fetchPriority={index < 4 ? "high" : undefined}
                    onError={handleShareThumbnailError}
                  />
                ) : centeredFileCard ? (
                  <Box
                    component="span"
                    className={classes.fileCentered}
                    aria-hidden
                  />
                ) : item.fileNames?.length ? (
                  <Box
                    component="span"
                    className={classes.fileList}
                    aria-hidden
                  >
                    {item.fileNames.slice(0, 3).map((fileName, fileIndex) => (
                      <Box
                        component="span"
                        className={classes.fileRow}
                        key={`${fileName}-${fileIndex}`}
                      >
                        <TbFile size={14} aria-hidden />
                        <Box component="span" className={classes.fileName}>
                          {fileName}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box
                    component="span"
                    className={classes.fileFallback}
                    aria-hidden
                  >
                    <TbFile size={44} />
                  </Box>
                )}

                <Box component="span" className={classes.scrim} aria-hidden />

                <Box component="span" className={classes.topRow}>
                  {showMediaBadge && (
                    <Box
                      component="span"
                      className={`${classes.badge} ${classes.mediaBadge}`}
                    >
                      {hasVideo ? (
                        <TbPlayerPlay size={14} aria-hidden />
                      ) : (
                        <TbPhoto size={14} aria-hidden />
                      )}
                      {hasVideo
                        ? t("trending.custom.video")
                        : t("trending.custom.image")}
                    </Box>
                  )}
                  <Box
                    component="span"
                    className={classes.badge}
                    aria-label={t("trending.custom.views", {
                      count: item.views,
                    })}
                  >
                    <TbEye size={15} aria-hidden />
                    {views}
                  </Box>
                </Box>

                {centeredFileCard ? (
                  <Box component="span" className={classes.centeredBody}>
                    <Text
                      component="span"
                      className={classes.centeredName}
                      lineClamp={3}
                    >
                      {name}
                    </Text>
                    {description && (
                      <Text
                        component="span"
                        className={classes.centeredDescription}
                        lineClamp={3}
                      >
                        {description}
                      </Text>
                    )}
                    <Box component="span" className={classes.centeredMeta}>
                      {metaItems}
                    </Box>
                  </Box>
                ) : (
                  <Box component="span" className={classes.body}>
                    <Text component="span" className={classes.name} lineClamp={2}>
                      {name}
                    </Text>
                    {description && (
                      <Text
                        component="span"
                        className={classes.description}
                        lineClamp={2}
                      >
                        {description}
                      </Text>
                    )}
                    <Box component="span" className={classes.meta}>
                      {metaItems}
                    </Box>
                  </Box>
                )}
              </UnstyledButton>
            );
          })}
        </div>
      )}

      {!showPlaceholder && visibleCount < items.length && (
        <div
          ref={moreRef}
          className={classes.grid}
          data-testid="trending-grid-more"
          aria-hidden
          style={{ marginTop: "var(--mantine-spacing-md)" }}
        >
          {Array.from(
            { length: Math.min(items.length - visibleCount, 4) },
            (_, index) => (
              <Box
                key={index}
                className={classes.card}
                sx={{ pointerEvents: "none" }}
              >
                <Skeleton height={210} radius={0} />
              </Box>
            ),
          )}
        </div>
      )}
    </>
  );

  return (
    <section ref={sectionRef} aria-labelledby="trending-title">
      {embedded ? (
        <div className={classes.root}>{content}</div>
      ) : (
        <Container className={classes.root}>{content}</Container>
      )}
    </section>
  );
};

export default TrendingToday;
