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
import { useIntl } from "react-intl";
import {
  TbCalendar,
  TbDatabase,
  TbEye,
  TbFiles,
  TbPlayerPlay,
} from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { TrendingShare } from "../../types/share.type";
import { getShareFileUrl } from "../../utils/file.util";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import LazyVideo from "../core/LazyVideo";

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
  previewBlur = 6,
  children,
}: {
  initialItems?: TrendingShare[];
  embedded?: boolean;
  limit?: number;
  previewBlur?: 4 | 6;
  children?: ReactNode;
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const mediaClassName = `${classes.media}${
    previewBlur === 4 ? ` ${classes.mediaSoft}` : ""
  }`;
  const [items, setItems] = useState<TrendingShare[]>(initialItems ?? []);
  const [isLoading, setIsLoading] = useState(!initialItems?.length);
  const [shouldLoad, setShouldLoad] = useState(!!initialItems?.length);
  const sectionRef = useRef<HTMLElement>(null);

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
        if (!entries[0]?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "400px" },
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
    shareService
      .getTrending(limit)
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
  }, [shouldLoad, limit]);

  const visibleItems = items;
  const title = t("trending.custom.title");
  const showPlaceholder = isLoading || !shouldLoad;

  if (!showPlaceholder && visibleItems.length === 0 && !embedded) return null;

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
          {showPlaceholder
            ? t("trending.custom.loading")
            : t("trending.custom.description")}
        </Text>
      </Group>

      {children}

      {!showPlaceholder && visibleItems.length === 0 ? (
        <Text className={classes.subheading} mt="xs">
          {t("trending.custom.empty")}
        </Text>
      ) : showPlaceholder ? (
        <div className={classes.grid} aria-hidden>
          {Array.from({ length: Math.min(limit, 48) }, (_, index) => (
            <Box
              key={index}
              className={classes.card}
              sx={{ pointerEvents: "none" }}
            >
              <Skeleton height={210} radius={0} />
            </Box>
          ))}
        </div>
      ) : (
        <div className={classes.grid} data-testid="trending-grid">
          {visibleItems.map((item) => {
            const name = item.name || item.id;
            const views = item.views.toLocaleString(intl.locale);
            const url = getShareFileUrl(item.id, item.previewFileId, {
              download: false,
            });
            const imageUrl = getShareFileUrl(item.id, item.previewFileId, {
              download: false,
              webp: true,
            });
            const createdAt = item.createdAt
              ? new Date(item.createdAt)
              : undefined;
            const uploadedAt =
              createdAt && !Number.isNaN(createdAt.getTime())
                ? intl.formatDate(createdAt, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })
                : undefined;
            const description = item.description?.trim();

            return (
              <UnstyledButton
                key={item.id}
                component={Link}
                href={`/share/${item.id}`}
                className={classes.card}
                title={name}
              >
                {item.previewKind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={mediaClassName}
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <LazyVideo
                    className={mediaClassName}
                    src={`${url}#t=0.1`}
                    muted
                    playsInline
                    aria-hidden="true"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}

                <Box component="span" className={classes.scrim} aria-hidden />

                <Box component="span" className={classes.topRow}>
                  {item.previewKind === "video" && (
                    <Box
                      component="span"
                      className={`${classes.badge} ${classes.mediaBadge}`}
                    >
                      <TbPlayerPlay size={14} aria-hidden />
                      {t("trending.custom.video")}
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
                    {uploadedAt && (
                      <Box component="span" className={classes.metaItem}>
                        <TbCalendar size={14} aria-hidden />
                        <time dateTime={item.createdAt}>
                          {t("trending.custom.uploaded", { date: uploadedAt })}
                        </time>
                      </Box>
                    )}
                  </Box>
                </Box>
              </UnstyledButton>
            );
          })}
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
