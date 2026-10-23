import {
  Box,
  Center,
  Container,
  createStyles,
  Group,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { TbEye, TbPlayerPlay } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { TrendingShare } from "../../types/share.type";

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
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: theme.spacing.md,

      [theme.fn.smallerThan("lg")]: {
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      },

      [theme.fn.smallerThan("xs")]: {
        gridTemplateColumns: "minmax(0, 1fr)",
      },
    },

    card: {
      position: "relative",
      display: "block",
      width: "100%",
      height: 250,
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
    },

    media: {
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      backgroundColor: "#000",
      filter: "blur(2px)",
      transform: "scale(1.01)",
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
}: {
  initialItems?: TrendingShare[];
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const [items, setItems] = useState<TrendingShare[]>(initialItems ?? []);

  useEffect(() => {
    if (initialItems) return;

    let cancelled = false;
    shareService
      .getTrending()
      .then((trending) => {
        if (!cancelled) setItems(trending);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [initialItems]);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="trending-title">
      <Container className={classes.root}>
        <Group position="apart" align="baseline" mb="md">
          <Text id="trending-title" className={classes.heading}>
            {t("trending.custom.title")}
          </Text>
          <Text className={classes.subheading}>
            {t("trending.custom.description")}
          </Text>
        </Group>

        <div className={classes.grid}>
          {items.map((item) => {
            const name = item.name || item.id;
            const views = item.views.toLocaleString(intl.locale);
            const url = `/api/shares/${item.id}/files/${item.previewFileId}?download=false`;

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
                    className={classes.media}
                    src={url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <>
                    <video
                      className={classes.media}
                      src={`${url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
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
      </Container>
    </section>
  );
};

export default TrendingToday;
