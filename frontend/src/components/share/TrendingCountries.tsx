import {
  Box,
  createStyles,
  Group,
  Paper,
  SimpleGrid,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { useIntl } from "react-intl";
import { TbClockHour4, TbEye, TbPlayerPlay, TbWorld } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { TrendingCountry } from "../../types/share.type";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { getShareFileUrl } from "../../utils/file.util";
import LazyVideo from "../core/LazyVideo";

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
      marginTop: theme.spacing.xl,
      marginBottom: theme.spacing.xl,
      padding: theme.spacing.lg,

      [theme.fn.smallerThan("xs")]: {
        padding: theme.spacing.md,
      },
    },

    header: {
      minWidth: 0,
    },

    headingIcon: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 38,
      height: 38,
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
      marginTop: theme.spacing.xs,
    },

    tabList: {
      flexWrap: "wrap",
      gap: 6,
      borderBottom: 0,
    },

    tab: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 36,
      padding: "0 11px",
      fontSize: theme.fontSizes.sm,
      fontWeight: 600,

      "&[data-active] span:last-of-type": {
        backgroundColor: "rgba(255, 255, 255, 0.22)",
        color: theme.white,
      },
    },

    tabCount: {
      marginLeft: 1,
      padding: "1px 5px",
      borderRadius: 999,
      backgroundColor: theme.fn.rgba(primary, 0.12),
      color: primary,
      fontSize: 10,
      fontWeight: 800,
      lineHeight: 1.35,
      fontVariantNumeric: "tabular-nums",
    },

    flag: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      height: 18,
      flexShrink: 0,
      fontSize: 16,
      lineHeight: 1,
    },

    list: {
      marginTop: theme.spacing.md,
    },

    row: {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing.sm,
      width: "100%",
      minWidth: 0,
      padding: 8,
      border: `1px solid ${border}`,
      borderRadius: theme.radius.sm,
      backgroundColor: rowBackground,
      textAlign: "left",
      transition: "border-color 120ms ease, background-color 120ms ease",

      "&:hover": {
        borderColor: primary,
        backgroundColor: theme.fn.rgba(primary, 0.05),
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
      width: 24,
      height: 24,
      flexShrink: 0,
      borderRadius: "50%",
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[6]
          : theme.colors.gray[1],
      color: muted,
      fontSize: theme.fontSizes.xs,
      fontWeight: 800,
      textAlign: "center",
      fontVariantNumeric: "tabular-nums",
    },

    rankTop: {
      backgroundColor: theme.fn.rgba(primary, 0.14),
      color: primary,
    },

    thumb: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 44,
      height: 44,
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
    },

    videoThumb: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      backgroundColor: "#000",
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
      gap: 4,
      marginTop: 2,
      color: muted,
      fontSize: theme.fontSizes.xs,
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

  if (!countries?.length) return null;

  const visibleCountries = countries.filter(
    (country) => country.shares.length > 0,
  );
  if (visibleCountries.length === 0) return null;

  const formatCount = (value: number) => intl.formatNumber(value);
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
        mb="md"
        className={classes.header}
      >
        <Group spacing="sm" noWrap>
          <Box className={classes.headingIcon}>
            <TbWorld size={20} aria-hidden />
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
        className={classes.tabs}
      >
        <Tabs.List className={classes.tabList}>
          {visibleCountries.map(({ country, views }) => {
            const name = getCountryName(country, intl.locale);
            return (
              <Tabs.Tab key={country} value={country} className={classes.tab}>
                <Box component="span" className={classes.flag} aria-hidden>
                  {countryCodeToFlag(country)}
                </Box>
                <Text component="span" size="sm" weight={600}>
                  {name}
                </Text>
                <Box component="span" className={classes.tabCount}>
                  {formatCount(views)}
                </Box>
              </Tabs.Tab>
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
                spacing="sm"
                verticalSpacing="sm"
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
                      aria-label={`${label} — ${t(
                        "trending.custom.countries.views",
                        { count: item.views },
                      )}`}
                    >
                      <Box
                        component="span"
                        className={`${classes.rank} ${
                          index < 3 ? classes.rankTop : ""
                        }`}
                      >
                        {formatCount(index + 1)}
                      </Box>
                      <Box component="span" className={classes.thumb}>
                        {item.previewKind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={classes.thumbImage}
                            src={getShareFileUrl(item.id, item.previewFileId, {
                              download: false,
                              webp: true,
                            })}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <Box component="span" className={classes.videoThumb}>
                            <LazyVideo
                              className={classes.thumbImage}
                              src={`${getShareFileUrl(
                                item.id,
                                item.previewFileId,
                                { download: false },
                              )}#t=0.1`}
                              muted
                              playsInline
                              aria-hidden="true"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                            <Box
                              component="span"
                              className={classes.playOverlay}
                            >
                              <TbPlayerPlay size={14} aria-hidden />
                            </Box>
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
                          <TbEye size={13} aria-hidden />
                          {t("trending.custom.countries.views", {
                            count: item.views,
                          })}
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

export default TrendingCountries;
