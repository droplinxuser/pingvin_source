import {
  Anchor,
  Box,
  Center,
  Container,
  createStyles,
  Group,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { TbEye, TbPlayerPlay } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { TrendingShare } from "../../types/share.type";
import { getShareFileUrl } from "../../utils/file.util";
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
    },

    card: {
      position: "relative",
      display: "block",
      width: "100%",
      height: 150,
      padding: 0,
      overflow: "hidden",
      border: `1px solid ${border}`,
      borderRadius: theme.radius.md,
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[8]
          : theme.colors.gray[2],
      color: "inherit",
      transition: "transform 120ms ease, border-color 120ms ease",

      "&:hover": {
        transform: "translateY(-2px)",
        borderColor:
          theme.colors[theme.primaryColor][
            theme.colorScheme === "dark" ? 5 : 4
          ],
      },

      "&:hover img, &:hover video": {
        filter: "blur(0)",
      },
    },

    media: {
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      backgroundColor: "#000",
      filter: "blur(2px)",
      transform: "scale(1.01)",
      transition: "filter 120ms ease",
    },

    mediaSharp: {
      filter: "none",
    },

    views: {
      position: "absolute",
      top: 10,
      right: 10,
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "5px 9px",
      borderRadius: theme.radius.sm,
      backgroundColor: "rgba(0, 0, 0, 0.72)",
      color: "white",
      fontSize: theme.fontSizes.sm,
      fontWeight: 700,
      lineHeight: 1,
      pointerEvents: "none",
    },

    playIcon: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
    },
  };
});

const TrendingToday = ({
  initialItems,
  embedded = false,
  limit = 12,
}: {
  initialItems?: TrendingShare[];
  embedded?: boolean;
  limit?: number;
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const hasInitialItems = !!initialItems?.length;
  const [items, setItems] = useState<TrendingShare[]>(initialItems ?? []);
  const [isLoading, setIsLoading] = useState(!hasInitialItems);

  useEffect(() => {
    if (initialItems?.length) {
      setItems(initialItems);
      setIsLoading(false);
      return;
    }

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
  }, [initialItems, limit]);

  const visibleItems = initialItems?.length ? initialItems : items;
  const title = t("trending.custom.title");
  if (visibleItems.length === 0) {
    if (!embedded) return null;

    return (
      <Container className={classes.root}>
        <section aria-labelledby="trending-title">
          <Title order={1} id="trending-title" className={classes.heading}>
            {title}
          </Title>
          <Text className={classes.subheading} mt="xs">
            {isLoading
              ? t("trending.custom.loading")
              : t("trending.custom.empty")}
          </Text>
        </section>
      </Container>
    );
  }

  const mediaClassName = embedded
    ? `${classes.media} ${classes.mediaSharp}`
    : classes.media;
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
          {t("trending.custom.description")}
        </Text>
      </Group>

      <div className={classes.grid}>
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

          return (
            <UnstyledButton
              key={item.id}
              component={Link}
              href={`/share/${item.id}`}
              className={classes.card}
              aria-label={t("trending.custom.item", { name, count: views })}
              title={name}
            >
              {item.previewKind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={mediaClassName}
                  src={imageUrl}
                  alt={name}
                  loading="lazy"
                  decoding="async"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <>
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
                  <Center className={classes.playIcon}>
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

              <Box component="span" className={classes.views} aria-hidden>
                <TbEye size={16} />
                {views}
              </Box>
            </UnstyledButton>
          );
        })}
      </div>
    </>
  );

  return (
    <section aria-labelledby="trending-title">
      {embedded ? (
        <div className={classes.root}>{content}</div>
      ) : (
        <Container className={classes.root}>{content}</Container>
      )}
    </section>
  );
};

export default TrendingToday;
