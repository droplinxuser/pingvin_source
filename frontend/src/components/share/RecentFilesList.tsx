import {
  Box,
  Container,
  createStyles,
  Group,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
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
} from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { TrendingShare } from "../../types/share.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import RelativeTime from "../core/RelativeTime";

// Long listings (the newest 200 shares) are revealed in batches as the visitor
// scrolls, so the browser never builds hundreds of rows at once.
const ROW_BATCH_SIZE = 20;

const useStyles = createStyles((theme) => {
  const border =
    theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2];
  const hoverBg =
    theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[0];

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

    list: {
      display: "flex",
      flexDirection: "column",
      gap: theme.spacing.sm,
    },

    row: {
      display: "flex",
      alignItems: "flex-start",
      gap: theme.spacing.md,
      width: "100%",
      padding: `${theme.spacing.md}px ${theme.spacing.md}px`,
      border: `1px solid ${border}`,
      borderRadius: theme.radius.md,
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[8]
          : theme.white,
      textAlign: "left",
      transition: "border-color 120ms ease, background-color 120ms ease",

      "&:hover": {
        borderColor:
          theme.colors[theme.primaryColor][
            theme.colorScheme === "dark" ? 5 : 4
          ],
        backgroundColor: hoverBg,
      },

      "&:focus-visible": {
        outline: `2px solid ${
          theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 5 : 4]
        }`,
        outlineOffset: 2,
      },

      [theme.fn.smallerThan("sm")]: {
        flexWrap: "wrap",
      },
    },

    icon: {
      flexShrink: 0,
      marginTop: 2,
    },

    main: {
      flex: 1,
      minWidth: 0,
    },

    name: {
      fontSize: theme.fontSizes.md,
      fontWeight: 700,
      lineHeight: 1.35,
      overflowWrap: "anywhere",
    },

    description: {
      marginTop: 4,
      color:
        theme.colorScheme === "dark"
          ? theme.colors.dark[2]
          : theme.colors.gray[6],
      fontSize: theme.fontSizes.sm,
      lineHeight: 1.45,
      overflowWrap: "anywhere",
    },

    meta: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "flex-end",
      columnGap: theme.spacing.md,
      rowGap: 6,
      marginTop: 4,
      color:
        theme.colorScheme === "dark"
          ? theme.colors.dark[2]
          : theme.colors.gray[6],
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
      whiteSpace: "nowrap",

      [theme.fn.smallerThan("sm")]: {
        justifyContent: "flex-start",
        width: "100%",
        paddingLeft: 34,
      },
    },

    metaItem: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
    },
  };
});

const RecentFilesList = ({
  initialItems,
  limit = 200,
  title: titleOverride,
  description: descriptionOverride,
  loadingText: loadingOverride,
  emptyText: emptyOverride,
  loadItems = shareService.getRecentFiles,
}: {
  initialItems?: TrendingShare[];
  limit?: number;
  title?: string;
  description?: string;
  loadingText?: string;
  emptyText?: string;
  loadItems?: (limit: number) => Promise<TrendingShare[]>;
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const title = titleOverride ?? t("newFiles.custom.title");
  const description = descriptionOverride ?? t("newFiles.custom.description");
  const loadingText = loadingOverride ?? t("newFiles.custom.loading");
  const emptyText = emptyOverride ?? t("newFiles.custom.empty");

  const [items, setItems] = useState<TrendingShare[]>(initialItems ?? []);
  const [isLoading, setIsLoading] = useState(!initialItems?.length);
  const [shouldLoad, setShouldLoad] = useState(!!initialItems?.length);
  const [visibleCount, setVisibleCount] = useState(ROW_BATCH_SIZE);
  const sectionRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialItems?.length) return;
    setItems(initialItems);
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
    if (!shouldLoad || items.length > 0) return;

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

  const renderPlaceholders = (count: number) => (
    <div className={classes.list} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <Box key={index} className={classes.row} sx={{ pointerEvents: "none" }}>
          <Skeleton height={20} width={20} radius="xl" className={classes.icon} />
          <Stack spacing={8} className={classes.main}>
            <Skeleton height={16} width="55%" radius="sm" />
            <Skeleton height={12} width="80%" radius="sm" />
          </Stack>
        </Box>
      ))}
    </div>
  );

  const content = (
    <>
      <Group position="apart" align="baseline" mb="md">
        <Title order={1} id="recent-files-title" className={classes.heading}>
          {title}
        </Title>
        <Text className={classes.subheading}>
          {showPlaceholder ? loadingText : description}
        </Text>
      </Group>

      {!showPlaceholder && items.length === 0 ? (
        <Text className={classes.subheading} mt="xs">
          {emptyText}
        </Text>
      ) : showPlaceholder ? (
        renderPlaceholders(Math.min(limit, ROW_BATCH_SIZE))
      ) : (
        <div className={classes.list} data-testid="recent-files-list">
          {visibleItems.map((item) => {
            const name = item.name || item.id;
            const views = item.views.toLocaleString(intl.locale);
            const itemDescription = item.description?.trim();

            return (
              <UnstyledButton
                key={item.id}
                component={Link}
                href={`/share/${item.id}`}
                className={classes.row}
                title={name}
              >
                <ThemeIcon
                  className={classes.icon}
                  variant="light"
                  size={28}
                  radius="md"
                  aria-hidden
                >
                  <TbFile size={17} />
                </ThemeIcon>

                <Box component="span" className={classes.main}>
                  <Text component="span" className={classes.name} lineClamp={2}>
                    {name}
                  </Text>
                  {itemDescription && (
                    <Text
                      component="span"
                      className={classes.description}
                      lineClamp={3}
                    >
                      {itemDescription}
                    </Text>
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
                    className={classes.metaItem}
                    aria-label={t("trending.custom.views", { count: item.views })}
                  >
                    <TbEye size={14} aria-hidden />
                    {views}
                  </Box>
                </Box>
              </UnstyledButton>
            );
          })}
        </div>
      )}

      {!showPlaceholder && visibleCount < items.length && (
        <Box ref={moreRef} mt="md">
          {renderPlaceholders(Math.min(items.length - visibleCount, 4))}
        </Box>
      )}
    </>
  );

  return (
    <section ref={sectionRef} aria-labelledby="recent-files-title">
      <Container className={classes.root}>{content}</Container>
    </section>
  );
};

export default RecentFilesList;
