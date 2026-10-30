import {
  Box,
  Button,
  Container,
  createStyles,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  TbCalendar,
  TbChevronRight,
  TbDatabase,
  TbEye,
  TbFile,
  TbFiles,
} from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { TrendingShare } from "../../types/share.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import RelativeTime from "../core/RelativeTime";

// Long listings (up to 200 shares) are revealed in batches as the visitor
// scrolls, so the browser never builds hundreds of rows at once.
const ROW_BATCH_SIZE = 20;

const useStyles = createStyles((theme) => {
  const dark = theme.colorScheme === "dark";
  const border = dark ? theme.colors.dark[5] : theme.colors.gray[2];
  const dimmed = dark ? theme.colors.dark[2] : theme.colors.gray[6];
  const accent = theme.colors[theme.primaryColor][dark ? 4 : 6];

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

    subheading: {
      color: dimmed,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    list: {
      display: "flex",
      flexDirection: "column",
      gap: theme.spacing.md,
    },

    // Card-like rows: a soft surface that lifts on hover, with the icon,
    // title block and metadata vertically centered.
    row: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: theme.spacing.md,
      width: "100%",
      // `theme.spacing.*` already includes its unit; appending `px` made the
      // value invalid and the padding was dropped, leaving the icon flush with
      // the card edge.
      padding: theme.spacing.md,
      border: `1px solid ${border}`,
      borderRadius: theme.radius.lg,
      backgroundColor: dark ? theme.colors.dark[7] : theme.white,
      boxShadow: dark
        ? "0 1px 2px rgba(0, 0, 0, 0.4)"
        : "0 1px 2px rgba(16, 24, 40, 0.04)",
      textAlign: "left",
      transition:
        "transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease",

      "&:hover": {
        transform: "translateY(-1px)",
        borderColor: theme.colors[theme.primaryColor][dark ? 5 : 4],
        boxShadow: dark
          ? "0 8px 20px rgba(0, 0, 0, 0.5)"
          : "0 8px 20px rgba(16, 24, 40, 0.08)",
      },

      "&:focus-visible": {
        outline: `2px solid ${theme.colors[theme.primaryColor][dark ? 5 : 4]}`,
        outlineOffset: 2,
      },

      [theme.fn.smallerThan("sm")]: {
        alignItems: "flex-start",
        flexWrap: "wrap",
      },
    },

    // Rounded gradient tile behind the file glyph.
    iconTile: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      width: 46,
      height: 46,
      borderRadius: theme.radius.md,
      color: accent,
      background: dark
        ? `linear-gradient(135deg, ${theme.colors.dark[6]} 0%, ${theme.colors.dark[5]} 100%)`
        : `linear-gradient(135deg, ${theme.colors[theme.primaryColor][0]} 0%, ${theme.colors.gray[1]} 100%)`,

      "& svg": {
        transition: "transform 120ms ease",
      },

      ".mantine-UnstyledButton-root:hover & svg": {
        transform: "scale(1.08)",
      },
    },

    main: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      gap: 4,
    },

    name: {
      fontSize: theme.fontSizes.md,
      fontWeight: 700,
      lineHeight: 1.35,
      overflowWrap: "anywhere",
    },

    description: {
      color: dimmed,
      fontSize: theme.fontSizes.sm,
      lineHeight: 1.5,
      overflowWrap: "anywhere",
    },

    files: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      marginTop: 2,
    },

    fileLine: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      minWidth: 0,
      color: dimmed,
      fontSize: theme.fontSizes.sm,
      lineHeight: 1.3,
    },

    fileName: {
      minWidth: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },

    meta: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "flex-end",
      columnGap: theme.spacing.md,
      rowGap: theme.spacing.sm,
      color: dimmed,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
      whiteSpace: "nowrap",

      [theme.fn.smallerThan("sm")]: {
        justifyContent: "flex-start",
        width: "100%",
        // Align the wrapped metadata under the title (tile 46 + row gap 16).
        paddingLeft: 62,
      },
    },

    metaItem: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 9px",
      borderRadius: theme.radius.xl,
      backgroundColor: dark ? theme.colors.dark[6] : theme.colors.gray[0],
    },

    chevron: {
      flexShrink: 0,
      color: dark ? theme.colors.dark[3] : theme.colors.gray[4],
      display: "flex",

      [theme.fn.smallerThan("sm")]: {
        display: "none",
      },
    },
  };
});

const ShareList = ({
  initialItems,
  limit = 200,
  title: titleOverride,
  description: descriptionOverride,
  loadingText: loadingOverride,
  emptyText: emptyOverride,
  loadItems,
  showDescription = true,
  showFileNames = false,
  fileNameLimit = 6,
  testId = "share-list",
}: {
  initialItems?: TrendingShare[] | null;
  limit?: number;
  title?: string;
  description?: string;
  loadingText?: string;
  emptyText?: string;
  loadItems: (limit: number) => Promise<TrendingShare[]>;
  showDescription?: boolean;
  showFileNames?: boolean;
  fileNameLimit?: number;
  testId?: string;
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const title = titleOverride ?? t("newFiles.custom.title");
  const description = descriptionOverride ?? t("newFiles.custom.description");
  const loadingText = loadingOverride ?? t("newFiles.custom.loading");
  const emptyText = emptyOverride ?? t("newFiles.custom.empty");
  const titleId = `${testId}-title`;

  const hasInitialData = Array.isArray(initialItems);
  const [items, setItems] = useState<TrendingShare[]>(initialItems ?? []);
  const [hasServerData, setHasServerData] = useState(hasInitialData);
  const [isLoading, setIsLoading] = useState(!hasInitialData);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [shouldLoad, setShouldLoad] = useState(hasInitialData);
  const [visibleCount, setVisibleCount] = useState(ROW_BATCH_SIZE);
  const sectionRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // See TrendingToday: an empty array from the server must clear a previous
    // listing, while `undefined` keeps the widget's lazy loader in charge.
    if (!Array.isArray(initialItems)) return;
    setItems(initialItems);
    setHasServerData(true);
    setIsLoading(false);
    setShouldLoad(true);
  }, [initialItems]);

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
    if (hasServerData || !shouldLoad || items.length > 0) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);
    loadItems(limit)
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasServerData, shouldLoad, limit, loadItems, retryToken]);

  const showPlaceholder = isLoading || (!shouldLoad && !hasServerData);

  useEffect(() => {
    setVisibleCount(ROW_BATCH_SIZE);
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
          Math.min(count + ROW_BATCH_SIZE, items.length),
        );
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length, showPlaceholder, visibleCount]);

  const visibleItems = items.slice(0, visibleCount);

  const placeholder = (count: number): ReactNode => (
    <div className={classes.list} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <Box key={index} className={classes.row} sx={{ pointerEvents: "none" }}>
          <Skeleton height={46} width={46} radius="md" />
          <Stack spacing={8} sx={{ flex: 1 }}>
            <Skeleton height={15} width="45%" radius="sm" />
            <Skeleton height={12} width="65%" radius="sm" />
          </Stack>
        </Box>
      ))}
    </div>
  );

  const content = (
    <>
      <Group position="apart" align="baseline" mb="md">
        <Title order={1} id={titleId} className={classes.heading}>
          {title}
        </Title>
        <Text className={classes.subheading}>
          {showPlaceholder ? loadingText : description}
        </Text>
      </Group>

      {!showPlaceholder && loadError ? (
        <Group position="center" mt="md" spacing="xs">
          <Text className={classes.subheading}>
            {t("common.custom.load-error")}
          </Text>
          <Button
            variant="light"
            size="xs"
            onClick={() => setRetryToken((n) => n + 1)}
          >
            {t("common.custom.retry")}
          </Button>
        </Group>
      ) : !showPlaceholder && items.length === 0 ? (
        <Text className={classes.subheading} mt="xs">
          {emptyText}
        </Text>
      ) : showPlaceholder ? (
        placeholder(Math.min(limit, ROW_BATCH_SIZE))
      ) : (
        <div className={classes.list} data-testid={testId}>
          {visibleItems.map((item) => {
            const name = item.name || item.id;
            const views = item.views.toLocaleString(intl.locale);
            const itemDescription = item.description?.trim();
            const fileNames = item.fileNames ?? [];

            return (
              <UnstyledButton
                key={item.id}
                component={Link}
                href={`/share/${item.id}`}
                className={classes.row}
                title={name}
              >
                <Box component="span" className={classes.iconTile} aria-hidden>
                  <TbFile size={22} />
                </Box>

                <Box component="span" className={classes.main}>
                  <Text component="span" className={classes.name} lineClamp={2}>
                    {name}
                  </Text>

                  {showDescription && itemDescription && (
                    <Text
                      component="span"
                      className={classes.description}
                      lineClamp={2}
                    >
                      {itemDescription}
                    </Text>
                  )}

                  {showFileNames && fileNames.length > 0 && (
                    <Box component="span" className={classes.files}>
                      {fileNames.slice(0, fileNameLimit).map((fileName, i) => (
                        <Box
                          component="span"
                          className={classes.fileLine}
                          key={`${fileName}-${i}`}
                        >
                          <TbFile size={15} aria-hidden />
                          <Box component="span" className={classes.fileName}>
                            {fileName}
                          </Box>
                        </Box>
                      ))}
                      {(item.fileCount ?? 0) > fileNames.length && (
                        <Box component="span" className={classes.fileLine}>
                          <TbFiles size={15} aria-hidden />
                          {t("shareList.custom.more-files", {
                            count: (item.fileCount ?? 0) - fileNames.length,
                          })}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>

                <Box component="span" className={classes.meta}>
                  {!!item.fileCount && (
                    <Box component="span" className={classes.metaItem}>
                      <TbFiles size={14} aria-hidden />
                      {t("trending.custom.files", { count: item.fileCount })}
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
                  <Box
                    component="span"
                    role="img"
                    className={classes.metaItem}
                    aria-label={t("trending.custom.views", {
                      count: item.views,
                    })}
                  >
                    <TbEye size={14} aria-hidden />
                    {views}
                  </Box>
                </Box>

                <Box component="span" className={classes.chevron} aria-hidden>
                  <TbChevronRight size={18} />
                </Box>
              </UnstyledButton>
            );
          })}
        </div>
      )}

      {!showPlaceholder && visibleCount < items.length && (
        <Box ref={moreRef} mt="md">
          {placeholder(Math.min(items.length - visibleCount, 4))}
        </Box>
      )}
    </>
  );

  return (
    <section ref={sectionRef} aria-labelledby={titleId}>
      <Container className={classes.root}>{content}</Container>
    </section>
  );
};

export default ShareList;
