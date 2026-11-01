import {
  Anchor,
  Box,
  Container,
  Divider,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { GetServerSidePropsContext } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import {
  TbBrowser,
  TbChartBar,
  TbDatabase,
  TbDeviceDesktop,
  TbDownload,
  TbEye,
  TbFiles,
  TbLink,
  TbUsers,
  TbWorld,
} from "react-icons/tb";
import Meta from "../components/Meta";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import {
  setNoStoreHeaders,
  setPublicCacheHeaders,
} from "../utils/httpCache.util";
import { fetchSiteStats } from "../utils/seo.server.util";
import { buildCollectionPage } from "../utils/seo.util";
import type { SiteStats, StatShare } from "../types/stats.type";
import { countryCodeToFlag, getCountryName } from "../utils/country.util";
import { byteToHumanSizeString } from "../utils/fileSize.util";
import { getCompactNumberFormat } from "../utils/number.util";

export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const stats = await fetchSiteStats(apiURL);
  // A failed backend response must not be pinned at the edge as a valid
  // zeroed page; a successful snapshot can be shared for a minute.
  if (stats) setPublicCacheHeaders(res, 60, 30);
  else setNoStoreHeaders(res);
  return { props: { stats } };
}

const SectionCard = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <Paper
    component="section"
    withBorder
    radius="md"
    p="md"
    sx={{ height: "100%" }}
  >
    <Group spacing="xs" align="center" noWrap>
      <ThemeIcon size={30} radius="sm" variant="light" color="blue">
        {icon}
      </ThemeIcon>
      <Text component="h2" size="md" weight={700} lh={1.2} m={0}>
        {title}
      </Text>
    </Group>
    <Divider my="sm" />
    {children}
  </Paper>
);

const RankList = ({
  items,
  empty,
}: {
  items: { key: string; label: string; count: number }[];
  empty: string;
}) => {
  const intl = useIntl();
  const compact = getCompactNumberFormat(intl.locale);
  const max = items[0]?.count ?? 0;

  if (items.length === 0)
    return (
      <Text size="sm" color="dimmed" py="sm">
        {empty}
      </Text>
    );

  return (
    <Stack spacing="xs">
      {items.slice(0, 20).map((item, index) => (
        <Box key={item.key}>
          <Group position="apart" noWrap spacing="xs">
            <Group spacing={6} noWrap sx={{ minWidth: 0 }}>
              <Text
                size="xs"
                color="dimmed"
                sx={{ width: 18, flexShrink: 0, textAlign: "right" }}
              >
                {index + 1}
              </Text>
              <Text size="sm" weight={600} truncate>
                {item.label}
              </Text>
            </Group>
            <Text size="xs" color="dimmed" sx={{ flexShrink: 0 }}>
              {compact.format(item.count)}
            </Text>
          </Group>
          <Progress
            value={max > 0 ? (item.count / max) * 100 : 0}
            size={4}
            radius="xl"
            mt={4}
            aria-label={`${item.label}: ${item.count}`}
          />
        </Box>
      ))}
    </Stack>
  );
};

const ShareRankList = ({
  items,
  metric,
  empty,
}: {
  items: StatShare[];
  metric: "views" | "downloads";
  empty: string;
}) => {
  const t = useTranslate();
  const intl = useIntl();
  const compact = getCompactNumberFormat(intl.locale);
  const MetricIcon = metric === "views" ? TbEye : TbDownload;

  if (items.length === 0)
    return (
      <Text size="sm" color="dimmed" py="sm">
        {empty}
      </Text>
    );

  return (
    <Stack spacing="sm">
      {items.slice(0, 20).map((share, index) => (
        <Group
          key={share.id}
          position="apart"
          align="flex-start"
          noWrap
          spacing="xs"
        >
          <Group spacing={6} align="flex-start" noWrap sx={{ minWidth: 0 }}>
            <Text
              size="xs"
              color="dimmed"
              sx={{ width: 18, flexShrink: 0, textAlign: "right" }}
            >
              {index + 1}
            </Text>
            <Box sx={{ minWidth: 0 }}>
              <Anchor
                component={Link}
                href={`/share/${share.id}`}
                size="sm"
                weight={600}
                display="block"
                truncate
              >
                {share.name || share.id}
              </Anchor>
              <Text size="xs" color="dimmed" truncate>
                {t("stats.custom.files", { count: share.fileCount })}
              </Text>
            </Box>
          </Group>
          <Group spacing={4} noWrap sx={{ flexShrink: 0 }}>
            <MetricIcon size={14} aria-hidden />
            <Text size="sm" weight={600}>
              {compact.format(
                (metric === "views" ? share.views : share.downloads) ?? 0,
              )}
            </Text>
          </Group>
        </Group>
      ))}
    </Stack>
  );
};

const StatsPage = ({ stats }: { stats: SiteStats | null }) => {
  const t = useTranslate();
  const intl = useIntl();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("stats.custom.description");
  const metaDescription = t("stats.custom.metaDescription", { siteName });
  const compact = getCompactNumberFormat(intl.locale);

  const jsonLd = buildCollectionPage({
    name: t("stats.custom.title"),
    description: metaDescription,
    path: "/stats",
    siteName,
    baseUrl,
  });

  const totals = stats?.totals;
  const summary = totals
    ? [
        {
          icon: <TbUsers size={18} />,
          label: t("stats.custom.totals.users"),
          value: compact.format(totals.userCount),
        },
        {
          icon: <TbLink size={18} />,
          label: t("stats.custom.totals.shares"),
          value: compact.format(totals.shareCount),
        },
        {
          icon: <TbFiles size={18} />,
          label: t("stats.custom.totals.files"),
          value: compact.format(totals.fileCount),
        },
        {
          icon: <TbDatabase size={18} />,
          label: t("stats.custom.totals.storage"),
          value: byteToHumanSizeString(totals.storageSizeBytes),
        },
        {
          icon: <TbEye size={18} />,
          label: t("stats.custom.totals.pageViews"),
          value: compact.format(totals.pageViews),
        },
        {
          icon: <TbDownload size={18} />,
          label: t("stats.custom.totals.downloads"),
          value: compact.format(totals.downloads),
        },
      ]
    : [];

  return (
    <>
      <Meta
        title={t("stats.custom.title")}
        description={metaDescription}
        canonicalPath="/stats"
        jsonLd={jsonLd}
      />
      <Container size="lg" my="xl" data-testid="stats-page">
        <Group align="flex-start" spacing="sm" noWrap>
          <ThemeIcon size={44} radius="md" variant="light" color="blue">
            <TbChartBar size={24} />
          </ThemeIcon>
          <Box>
            <Title order={1} size="h2">
              {t("stats.custom.heading", { siteName })}
            </Title>
            <Text color="dimmed" size="sm" mt={4}>
              {description}
            </Text>
          </Box>
        </Group>

        {!stats ? (
          <Paper withBorder radius="md" p="xl" mt="lg">
            <Text color="dimmed" align="center">
              {t("stats.custom.empty")}
            </Text>
          </Paper>
        ) : (
          <>
            <SimpleGrid
              cols={2}
              spacing="md"
              mt="lg"
              breakpoints={[
                { minWidth: "sm", cols: 3 },
                { minWidth: "lg", cols: 6 },
              ]}
            >
              {summary.map((item) => (
                <Paper key={item.label} withBorder radius="md" p="md">
                  <Group spacing={6} noWrap>
                    <ThemeIcon size={28} radius="sm" variant="light" color="blue">
                      {item.icon}
                    </ThemeIcon>
                    <Text size="xs" color="dimmed" weight={600} truncate>
                      {item.label}
                    </Text>
                  </Group>
                  <Text size="xl" weight={800} mt={6}>
                    {item.value}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>

            <Text size="xs" color="dimmed" mt="sm">
              {t("stats.custom.shareViews", {
                count: totals!.shareViews,
                compact: compact.format(totals!.shareViews),
              })}{" "}
              ·{" "}
              {t("stats.custom.lastDay", {
                count: stats.pageViewsLastDay,
                compact: compact.format(stats.pageViewsLastDay),
              })}
            </Text>

            <SimpleGrid
              cols={1}
              spacing="md"
              mt="lg"
              breakpoints={[{ minWidth: "lg", cols: 3 }]}
            >
              <SectionCard
                title={t("stats.custom.topCountries")}
                icon={<TbWorld size={16} />}
              >
                <RankList
                  items={stats.topCountries.map((entry) => ({
                    key: entry.country,
                    label: `${countryCodeToFlag(entry.country)} ${getCountryName(
                      entry.country,
                      intl.locale,
                    )}`,
                    count: entry.count,
                  }))}
                  empty={t("stats.custom.empty")}
                />
              </SectionCard>

              <SectionCard
                title={t("stats.custom.topOperatingSystems")}
                icon={<TbDeviceDesktop size={16} />}
              >
                <RankList
                  items={stats.topOperatingSystems.map((entry) => ({
                    key: entry.name,
                    label: entry.name,
                    count: entry.count,
                  }))}
                  empty={t("stats.custom.empty")}
                />
              </SectionCard>

              <SectionCard
                title={t("stats.custom.topBrowsers")}
                icon={<TbBrowser size={16} />}
              >
                <RankList
                  items={stats.topBrowsers.map((entry) => ({
                    key: entry.name,
                    label: entry.name,
                    count: entry.count,
                  }))}
                  empty={t("stats.custom.empty")}
                />
              </SectionCard>
            </SimpleGrid>

            <SimpleGrid
              cols={1}
              spacing="md"
              mt="md"
              breakpoints={[{ minWidth: "md", cols: 2 }]}
            >
              <SectionCard
                title={t("stats.custom.mostViewed")}
                icon={<TbEye size={16} />}
              >
                <ShareRankList
                  items={stats.mostViewed}
                  metric="views"
                  empty={t("stats.custom.empty")}
                />
              </SectionCard>

              <SectionCard
                title={t("stats.custom.mostDownloaded")}
                icon={<TbDownload size={16} />}
              >
                <ShareRankList
                  items={stats.mostDownloaded}
                  metric="downloads"
                  empty={t("stats.custom.emptyDownloads")}
                />
              </SectionCard>
            </SimpleGrid>

            <Text size="xs" color="dimmed" align="center" mt="lg">
              {t("stats.custom.privacy")}
            </Text>
          </>
        )}
      </Container>
    </>
  );
};

export default StatsPage;
