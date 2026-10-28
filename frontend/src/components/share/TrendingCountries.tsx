import {
  Box,
  createStyles,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { TbClockHour4, TbEye, TbPlayerPlay, TbWorld } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { TrendingCountry } from "../../types/share.type";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import {
  getShareThumbnailUrl,
  handleShareThumbnailError,
} from "../../utils/file.util";
import { getCompactNumberFormat } from "../../utils/number.util";
import { HoverTip } from "../core/HoverTip";
import LazyImage from "../core/LazyImage";

const useStyles = createStyles((theme) => {
  const border =
    theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[3];
  const muted =
    theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.colors.gray[6];
  const primary =
    theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 4 : 7];
  const rowBackground =
    theme.colorScheme === "dark" ? theme.colors.dark[8] : theme.white;

  return {
    root: {
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
      padding: theme.spacing.md,

      [theme.fn.smallerThan("xs")]: {
        padding: theme.spacing.sm,
      },
    },

    header: {
      minWidth: 0,
    },

    headingIcon: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 34,
      height: 34,
      flexShrink: 0,
      borderRadius: theme.radius.md,
      color: primary,
      backgroundColor: theme.fn.rgba(primary, 0.12),
    },

    heading: {
      fontSize: theme.fontSizes.lg,
      fontWeight: 800,
      lineHeight: 1.2,
    },

    subheading: {
      color: muted,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.3,
    },

    window: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      marginTop: 2,
      color: muted,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    tabs: {
      marginTop: 0,
    },

    tabList: {
      flexWrap: "wrap",
      gap: 4,
      borderBottom: 0,
    },

    tab: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: 32,
      minWidth: 32,
      padding: "0 7px",
      fontWeight: 600,

      "&[data-active] span[data-count]": {
        backgroundColor: "rgba(255, 255, 255, 0.22)",
        color: theme.white,
      },
    },

    tabCount: {
      padding: "0 4px",
      borderRadius: 999,
      backgroundColor: theme.fn.rgba(primary, 0.12),
      color: primary,
      fontSize: 9,
      fontWeight: 800,
      lineHeight: 1.6,
      fontVariantNumeric: "tabular-nums",
    },

    flag: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 20,
      height: 16,
      marginRight: 4,
      flexShrink: 0,
      fontSize: 15,
      lineHeight: 1,
    },

    list: {
      marginTop: theme.spacing.sm,
    },

    row: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      width: "100%",
      minWidth: 0,
      padding: 6,
      border: `1px solid ${border}`,
      borderRadius: theme.radius.sm,
      backgroundColor: rowBackground,
      textAlign: "left",
      transition: "border-color 120ms ease, background-color 120ms ease",

      "&:hover": {
        borderColor: primary,
        backgroundColor: theme.fn.rgba(primary, 0.05),
      },

      // The small country thumbnails stay deliberately soft so the list reads
      // as a ranking. Hovering or focusing a row reveals the exact frame.
      "&:hover img, &:hover video, &:focus-visible img, &:focus-visible video":
        {
          filter: "blur(0px)",
          transform: "scale(1.04)",
        },

      "&:focus-visible": {
        outline: `2px solid ${primary}`,
        outlineOffset: 2,
      },
    },

    rank: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      height: 22,
      flexShrink: 0,
      borderRadius: "50%",
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[6]
          : theme.colors.gray[1],
      color: muted,
      fontSize: 10,
      fontWeight: 800,
      textAlign: "center",
      fontVariantNumeric: "tabular-nums",
    },

    rankTop: {
      backgroundColor: theme.fn.rgba(primary, 0.14),
      color: primary,
    },

    thumb: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 38,
      height: 38,
      flexShrink: 0,
      overflow: "hidden",
      border: `1px solid ${border}`,
      borderRadius: theme.radius.sm,
      backgroundColor:
        theme.colorScheme === "dark" ? "#000" : theme.colors.gray[2],
      color: "white",
    },

    thumbImage: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      filter: "blur(2px)",
      transform: "scale(1.08)",
      transition: "filter 120ms ease, transform 120ms ease",
    },

    playOverlay: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      pointerEvents: "none",
      filter: "drop-shadow(0 1px 3px rgba(0, 0, 0, 0.9))",
    },

    body: {
      minWidth: 0,
      flex: 1,
    },

    name: {
      color: theme.colorScheme === "dark" ? theme.white : theme.colors.dark[8],
      fontSize: theme.fontSizes.sm,
      fontWeight: 600,
      lineHeight: 1.25,
      overflowWrap: "anywhere",
    },

    meta: {
      display: "flex",
      alignItems: "center",
      gap: 3,
      marginTop: 1,
      color: muted,
      fontSize: 11,
      lineHeight: 1.2,
    },
  };
});

const TrendingCountries = ({
  countries,
}: {
  countries?: TrendingCountry[];
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const [items, setItems] = useState<TrendingCountry[]>(countries ?? []);
  const [isLoading, setIsLoading] = useState(!countries?.length);

  useEffect(() => {
    if (countries?.length) {
      setItems(countries);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    shareService
      .getTrendingCountries()
      .then((value) => {
        if (!cancelled) setItems(value);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [countries]);

  if (isLoading) return <TrendingCountriesSkeleton />;
  if (!items.length) return null;

  const visibleCountries = items.filter((country) => country.shares.length > 0);
  if (visibleCountries.length === 0) return null;

  const formatCount = (value: number) =>
    getCompactNumberFormat(intl.locale).format(value);
  const formatViews = (views: number) =>
    views < 1000
      ? t("trending.custom.countries.views", { count: views })
      : t("trending.custom.countries.views-compact", {
          count: formatCount(views),
        });
  const initialCountry = visibleCountries[0].country;

  return (
    <Paper
      component="section"
      withBorder
      radius="md"
      className={classes.root}
      aria-labelledby="trending-countries-title"
      sx={(theme) => ({
        background:
          theme.colorScheme === "dark"
            ? `linear-gradient(180deg, ${theme.colors.dark[7]} 0%, ${theme.colors.dark[8]} 100%)`
            : `linear-gradient(180deg, ${theme.white} 0%, ${theme.colors.gray[0]} 100%)`,
      })}
    >
      <Group
        position="apart"
        align="flex-start"
        spacing="md"
        mb="sm"
        className={classes.header}
      >
        <Group spacing="sm" noWrap>
          <Box className={classes.headingIcon}>
            <TbWorld size={18} aria-hidden />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Title
              order={2}
              id="trending-countries-title"
              className={classes.heading}
            >
              {t("trending.custom.countries.title")}
            </Title>
            <Text className={classes.subheading}>
              {t("trending.custom.countries.description")}
            </Text>
          </Box>
        </Group>
        <Text className={classes.window}>
          <TbClockHour4 size={13} aria-hidden />
          {t("trending.custom.countries.window")}
        </Text>
      </Group>

      <Tabs
        variant="pills"
        defaultValue={initialCountry}
        // Only the selected country panel should exist in the DOM. Rendering
        // every panel put 100 hidden thumbnails and roughly a thousand extra
        // nodes on the trending page, even though one panel is visible.
        keepMounted={false}
        className={classes.tabs}
      >
        <Tabs.List className={classes.tabList}>
          {visibleCountries.map(({ country, views }) => {
            const name = getCountryName(country, intl.locale);
            return (
              <HoverTip key={country} label={name} position="top">
                <Tabs.Tab
                  value={country}
                  className={classes.tab}
                  aria-label={`${name} — ${formatViews(views)}`}
                >
                  <Box component="span" className={classes.flag} aria-hidden>
                    {countryCodeToFlag(country)}
                  </Box>
                  <Box component="span" className={classes.tabCount} data-count>
                    {formatCount(views)}
                  </Box>
                </Tabs.Tab>
              </HoverTip>
            );
          })}
        </Tabs.List>

        {visibleCountries.map(({ country, shares }) => {
          const name = getCountryName(country, intl.locale);
          return (
            <Tabs.Panel
              key={country}
              value={country}
              aria-label={t("trending.custom.countries.list", {
                country: name,
              })}
            >
              <SimpleGrid
                cols={2}
                spacing="xs"
                verticalSpacing="xs"
                className={classes.list}
                breakpoints={[{ maxWidth: "sm", cols: 1 }]}
              >
                {shares.map((item, index) => {
                  const label = item.name || item.id;
                  return (
                    <UnstyledButton
                      key={item.id}
                      component={Link}
                      href={`/share/${item.id}`}
                      className={classes.row}
                      title={label}
                    >
                      <Box
                        component="span"
                        className={`${classes.rank} ${
                          index < 3 ? classes.rankTop : ""
                        }`}
                      >
                        {index + 1}
                      </Box>
                      <Box component="span" className={classes.thumb}>
                        <LazyImage
                          className={classes.thumbImage}
                          src={getShareThumbnailUrl(item.id, item.updatedAt)}
                          alt=""
                          onError={handleShareThumbnailError}
                        />
                        {item.previewKind === "video" && (
                          <Box component="span" className={classes.playOverlay}>
                            <TbPlayerPlay size={14} aria-hidden />
                          </Box>
                        )}
                      </Box>
                      <Box component="span" className={classes.body}>
                        <Text
                          component="span"
                          className={classes.name}
                          lineClamp={1}
                        >
                          {label}
                        </Text>
                        <Box component="span" className={classes.meta}>
                          <TbEye size={12} aria-hidden />
                          {formatViews(item.views)}
                        </Box>
                      </Box>
                    </UnstyledButton>
                  );
                })}
              </SimpleGrid>
            </Tabs.Panel>
          );
        })}
      </Tabs>
    </Paper>
  );
};

export const TrendingCountriesSkeleton = () => {
  const { classes } = useStyles();

  return (
    <Paper
      withBorder
      radius="md"
      className={classes.root}
      aria-hidden
      data-testid="trending-countries-placeholder"
    >
      <Group
        position="apart"
        align="flex-start"
        spacing="md"
        mb="sm"
        className={classes.header}
      >
        <Group spacing="sm" noWrap>
          <Skeleton height={34} width={34} radius="md" />
          <Box sx={{ minWidth: 0 }}>
            <Skeleton height={14} width={220} radius="sm" />
            <Skeleton height={10} width={170} mt={6} radius="sm" />
          </Box>
        </Group>
        <Skeleton height={12} width={110} radius="sm" />
      </Group>

      <Group spacing={4}>
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} height={32} width={58} radius="sm" />
        ))}
      </Group>

      <SimpleGrid
        cols={2}
        spacing="xs"
        verticalSpacing="xs"
        className={classes.list}
        breakpoints={[{ maxWidth: "sm", cols: 1 }]}
      >
        {/* The backend caps each country panel at ten shares (five rows). */}
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} height={50} radius="sm" />
        ))}
      </SimpleGrid>
    </Paper>
  );
};

export default TrendingCountries;
