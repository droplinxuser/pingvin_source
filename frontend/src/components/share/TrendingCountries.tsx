import {
  Box,
  createStyles,
  Group,
  SimpleGrid,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { useIntl } from "react-intl";
import { TbEye, TbPlayerPlay } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { TrendingCountry } from "../../types/share.type";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { getShareFileUrl } from "../../utils/file.util";

const useStyles = createStyles((theme) => {
  const border =
    theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[3];
  const muted =
    theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.colors.gray[6];
  const surface =
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

    subheading: {
      color: muted,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.2,
    },

    tabList: {
      flexWrap: "wrap",
      gap: 6,
      borderBottom: 0,
    },

    tab: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      height: 34,
      padding: "0 10px",
      fontSize: theme.fontSizes.sm,
      fontWeight: 600,
    },

    tabCount: {
      marginLeft: 2,
      fontSize: 10,
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums",
      opacity: 0.72,
    },

    list: {
      marginTop: theme.spacing.md,
    },

    row: {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing.sm,
      width: "100%",
      padding: 8,
      border: `1px solid ${border}`,
      borderRadius: theme.radius.sm,
      backgroundColor: surface,
      textAlign: "left",
      transition: "border-color 120ms ease",

      "&:hover": {
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
    },

    rank: {
      width: 22,
      flexShrink: 0,
      color: muted,
      fontSize: theme.fontSizes.xs,
      fontWeight: 800,
      textAlign: "center",
      fontVariantNumeric: "tabular-nums",
    },

    thumb: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 44,
      height: 44,
      flexShrink: 0,
      overflow: "hidden",
      borderRadius: theme.radius.sm,
      backgroundColor:
        theme.colorScheme === "dark" ? "#000" : theme.colors.gray[3],
      color: "white",
    },

    thumbImage: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
    },

    videoThumb: {
      background:
        "linear-gradient(135deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.92))",
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

  const formatCount = (value: number) => intl.formatNumber(value);

  return (
    <section
      aria-labelledby="trending-countries-title"
      className={classes.root}
    >
      <Group position="apart" align="baseline" mb="md">
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
      </Group>

      <Tabs variant="pills" defaultValue={countries[0].country}>
        <Tabs.List className={classes.tabList}>
          {countries.map(({ country, views }) => {
            const name = getCountryName(country, intl.locale);
            return (
              <Tabs.Tab key={country} value={country} className={classes.tab}>
                <span aria-hidden>{countryCodeToFlag(country)}</span>
                <span>{name}</span>
                <span className={classes.tabCount}>{formatCount(views)}</span>
              </Tabs.Tab>
            );
          })}
        </Tabs.List>

        {countries.map(({ country, shares }) => {
          const name = getCountryName(country, intl.locale);
          return (
            <Tabs.Panel
              key={country}
              value={country}
              aria-label={t("trending.custom.countries.list", {
                country: name,
              })}
            >
              {shares.length === 0 ? (
                <Text size="xs" color="dimmed" mt="md">
                  {t("trending.custom.countries.empty")}
                </Text>
              ) : (
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
                        <Text component="span" className={classes.rank}>
                          {formatCount(index + 1)}
                        </Text>
                        <Box component="span" className={classes.thumb}>
                          {item.previewKind === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={classes.thumbImage}
                              src={getShareFileUrl(
                                item.id,
                                item.previewFileId,
                                { download: false, webp: true },
                              )}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <Box
                              component="span"
                              className={classes.videoThumb}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "100%",
                                height: "100%",
                              }}
                            >
                              <TbPlayerPlay size={18} aria-hidden />
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
              )}
            </Tabs.Panel>
          );
        })}
      </Tabs>
    </section>
  );
};

export default TrendingCountries;
