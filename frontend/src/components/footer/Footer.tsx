import {
  Anchor,
  Box,
  Container,
  createStyles,
  Footer as MFooter,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { TbEye } from "react-icons/tb";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, { SystemStats } from "../../services/system.service";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import { HoverTip } from "../core/HoverTip";

const useStyles = createStyles((theme) => {
  const muted =
    theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.colors.gray[6];
  const border =
    theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2];

  return {
    footer: {
      marginTop: theme.spacing.xl,
      borderTop: `1px solid ${border}`,
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.fn.rgba(theme.colors.dark[8], 0.65)
          : theme.colors.gray[0],
    },

    grid: {
      display: "grid",
      gridTemplateColumns: "1.15fr 1.6fr 1.25fr 0.8fr",
      gap: theme.spacing.xl,
      alignItems: "start",

      [theme.fn.smallerThan("md")]: {
        gridTemplateColumns: "1fr 1fr",
        gap: theme.spacing.lg,
      },

      [theme.fn.smallerThan("xs")]: {
        gridTemplateColumns: "1fr",
        gap: theme.spacing.md,
      },
    },

    brandName: {
      fontSize: theme.fontSizes.md,
      fontWeight: 800,
      lineHeight: 1.2,
    },

    tagline: {
      color: muted,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.4,
    },

    heading: {
      color: muted,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 1.1,
      lineHeight: 1,
      textTransform: "uppercase",
      marginBottom: 8,
    },

    statValue: {
      fontSize: theme.fontSizes.md,
      fontWeight: 700,
      lineHeight: 1.1,
    },

    statLabel: {
      color: muted,
      fontSize: 10,
      letterSpacing: 0.4,
      lineHeight: 1.2,
      textTransform: "uppercase",
    },

    activityLine: {
      color: muted,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1.4,
    },

    country: {
      color: muted,
      fontSize: theme.fontSizes.xs,
      lineHeight: 1,
    },

    link: {
      color: muted,
      fontSize: theme.fontSizes.xs,

      "&:hover": {
        color:
          theme.colors[theme.primaryColor][
            theme.colorScheme === "dark" ? 3 : 7
          ],
        textDecoration: "underline",
      },
    },

    legalLinks: {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 5,

      [theme.fn.smallerThan("md")]: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: theme.spacing.lg,
      },
    },

    copyright: {
      color: muted,
      fontSize: 10,
      lineHeight: 1.3,
      marginTop: 8,
    },
  };
});

const Footer = () => {
  const t = useTranslate();
  const intl = useIntl();
  const router = useRouter();
  const config = useConfig();
  const { classes } = useStyles();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // This is also the page-view beacon: one POST per rendered page, with the
  // counters kept in Valkey instead of SQLite.
  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      setIsLoadingStats(true);
      let result: SystemStats | null = null;
      try {
        result = await systemService.recordPageView();
      } catch {
        try {
          result = await systemService.getSystemStats();
        } catch {
          // The footer stays usable with placeholders when stats are offline.
        }
      }
      if (!cancelled) {
        setStats(result);
        setIsLoadingStats(false);
      }
    };

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [router.asPath]);

  const siteName = (config.get("general.appName") as string) || "DropMB";
  const hasImprint = !!(
    config.get("legal.imprintUrl") || config.get("legal.imprintText")
  );
  const hasPrivacy = !!(
    config.get("legal.privacyPolicyUrl") ||
    config.get("legal.privacyPolicyText")
  );
  const imprintUrl =
    (!config.get("legal.imprintText") && config.get("legal.imprintUrl")) ||
    "/imprint";
  const privacyUrl =
    (!config.get("legal.privacyPolicyText") &&
      config.get("legal.privacyPolicyUrl")) ||
    "/privacy";
  const contactUrl = "mailto:contactwebph@gmail.com";

  const compact = (value?: number) =>
    value == null
      ? "—"
      : Intl.NumberFormat(intl.locale, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value);

  const overview = [
    { value: compact(stats?.userCount), label: t("footer.custom.users") },
    { value: compact(stats?.shareCount), label: t("footer.custom.shares") },
    { value: compact(stats?.fileCount), label: t("footer.custom.files") },
    {
      value: stats ? byteToHumanSizeString(stats.storageSizeBytes) : "—",
      label: t("footer.custom.storage"),
    },
  ];

  const views = stats?.pageViewsLastDay ?? 0;
  const countries = stats?.topCountriesLastDay?.slice(0, 5) ?? [];

  return (
    <MFooter height="auto" className={classes.footer} zIndex={100}>
      <Container py="lg">
        <div className={classes.grid}>
          <Stack spacing={3}>
            <Text className={classes.brandName}>{siteName}</Text>
            <Text className={classes.tagline}>
              {t("footer.custom.tagline")}
            </Text>
            <Text className={classes.copyright}>
              {t("footer.custom.copyright", {
                year: new Date().getFullYear(),
                siteName,
              })}
            </Text>
          </Stack>

          <Box>
            <Text className={classes.heading}>
              {t("footer.custom.overview")}
            </Text>
            <SimpleGrid cols={2} spacing={8} verticalSpacing={10}>
              {overview.map(({ value, label }) => (
                <Box key={label}>
                  <Text className={classes.statValue}>{value}</Text>
                  <Text className={classes.statLabel}>{label}</Text>
                </Box>
              ))}
            </SimpleGrid>
          </Box>

          <Box>
            <Text className={classes.heading}>
              {t("footer.custom.activity")}
            </Text>
            <Group spacing={5} noWrap>
              <TbEye size={13} color="currentColor" />
              <Text className={classes.activityLine}>
                {isLoadingStats && !stats
                  ? t("footer.custom.loading")
                  : stats
                    ? t("footer.custom.views", { count: views })
                    : "—"}
              </Text>
            </Group>
            {countries.length > 0 && (
              <Group spacing={8} mt={7}>
                {countries.map(({ country, count }) => {
                  const name = getCountryName(country, intl.locale);
                  return (
                    <HoverTip key={country} label={name}>
                      <Group spacing={3} noWrap aria-label={name}>
                        <span aria-hidden>{countryCodeToFlag(country)}</span>
                        <Text className={classes.country}>{count}</Text>
                      </Group>
                    </HoverTip>
                  );
                })}
              </Group>
            )}
          </Box>

          <Box>
            <Text className={classes.heading}>{t("footer.custom.links")}</Text>
            <div className={classes.legalLinks}>
              <Anchor className={classes.link} href={contactUrl}>
                {t("footer.custom.contact")}
              </Anchor>
              {hasImprint && (
                <Anchor className={classes.link} href={imprintUrl}>
                  {t("imprint.title")}
                </Anchor>
              )}
              {hasPrivacy && (
                <Anchor className={classes.link} href={privacyUrl}>
                  {t("privacy.title")}
                </Anchor>
              )}
            </div>
          </Box>
        </div>
      </Container>
    </MFooter>
  );
};

export default Footer;
