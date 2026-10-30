import {
  Box,
  Card,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useIntl } from "react-intl";
import { TbActivity } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { Share } from "../../types/share.type";
import { HoverTip } from "../core/HoverTip";
import RelativeTime from "../core/RelativeTime";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { getBrowserIcon, getOsIcon, iconStyle } from "./UploaderInfoBadges";

const ShareStats = ({
  share,
  downloads,
}: {
  share: Share;
  downloads?: number;
}) => {
  const t = useTranslate();
  const intl = useIntl();
  const visitors = [...(share.uploaderInfo?.visitors ?? [])].reverse();
  const views = share.views ?? 0;

  return (
    <Paper
      component="section"
      aria-labelledby="share-stats-title"
      radius="md"
      p={{ base: "xs", sm: "sm" }}
      mt="md"
      withBorder
      data-testid="share-stats"
    >
      <Group position="apart" align="center" spacing="md">
        <Group spacing="xs" align="center" noWrap>
          <ThemeIcon size={28} radius="sm" variant="light">
            <TbActivity size={15} />
          </ThemeIcon>
          <Text
            component="h2"
            id="share-stats-title"
            size="sm"
            weight={700}
            lh={1.2}
            m={0}
          >
            {t("share.custom.stats.title")}
          </Text>
        </Group>
        <Group spacing="lg" align="center">
          <Group spacing={6} align="baseline" noWrap>
            <Text size="xs" color="dimmed" weight={600} tt="uppercase">
              {t("share.custom.stats.views")}
            </Text>
            <Text size={20} weight={800} lh={1}>
              {views.toLocaleString(intl.locale)}
            </Text>
          </Group>
          {downloads !== undefined && (
            <Group spacing={6} align="baseline" noWrap>
              <Text size="xs" color="dimmed" weight={600} tt="uppercase">
                {t("share.custom.stats.downloads")}
              </Text>
              <Text
                size={20}
                weight={800}
                lh={1}
                data-testid="share-downloads-total"
              >
                {downloads.toLocaleString(intl.locale)}
              </Text>
            </Group>
          )}
          {!!share.maxDownloads && (
            <Group spacing={6} align="baseline" noWrap>
              <Text size="xs" color="dimmed" weight={600} tt="uppercase">
                {t("share.custom.stats.download-limit")}
              </Text>
              <Text
                size={20}
                weight={800}
                lh={1}
                data-testid="share-download-limit"
              >
                {(share.downloadCount ?? 0).toLocaleString(intl.locale)} /{" "}
                {share.maxDownloads.toLocaleString(intl.locale)}
              </Text>
            </Group>
          )}
        </Group>
      </Group>

      <Divider my={4} />

      {visitors.length === 0 ? (
        <Box py={4}>
          <Text size="xs" color="dimmed" align="center">
            {t("share.custom.stats.empty")}
          </Text>
        </Box>
      ) : (
        <SimpleGrid
          cols={1}
          spacing={4}
          breakpoints={[
            { minWidth: "sm", cols: 2 },
            { minWidth: "md", cols: 3 },
          ]}
        >
          {visitors.map((visitor, index) => {
            const countryName = visitor.country
              ? getCountryName(visitor.country, intl.locale)
              : undefined;
            const location =
              [visitor.city, countryName].filter(Boolean).join(", ") ||
              t("share.custom.stats.unknown-location");

            return (
              <Card
                key={`${visitor.createdAt}-${index}`}
                radius="sm"
                px="xs"
                py={2}
                withBorder
              >
                <Group position="apart" align="center" noWrap spacing="xs">
                  <Group spacing={6} noWrap sx={{ minWidth: 0, flex: 1 }}>
                    <HoverTip label={location}>
                      <Text
                        size="sm"
                        role="img"
                        aria-label={location}
                        sx={{ cursor: "help" }}
                      >
                        {countryCodeToFlag(visitor.country)}
                      </Text>
                    </HoverTip>
                    <Text size="xs" truncate lh={1.3} sx={{ minWidth: 0 }}>
                      {visitor.referrer
                        ? t("share.custom.stats.via", {
                            domain: visitor.referrer,
                          })
                        : t("share.custom.stats.direct")}
                    </Text>
                    <Text
                      size="xs"
                      color="dimmed"
                      lh={1.3}
                      sx={{ whiteSpace: "nowrap" }}
                    >
                      <RelativeTime date={visitor.createdAt} />
                    </Text>
                  </Group>
                  <Group spacing={2} noWrap>
                    <HoverTip
                      label={visitor.os || t("share.custom.uploader.unknown")}
                    >
                      <span
                        role="img"
                        style={{ ...iconStyle, opacity: 0.85 }}
                        aria-label={t("share.custom.uploader.os")}
                      >
                        {getOsIcon(visitor.os)}
                      </span>
                    </HoverTip>
                    <HoverTip
                      label={
                        visitor.browser || t("share.custom.uploader.unknown")
                      }
                    >
                      <span
                        role="img"
                        style={{ ...iconStyle, opacity: 0.85 }}
                        aria-label={t("share.custom.uploader.browser")}
                      >
                        {getBrowserIcon(visitor.browser)}
                      </span>
                    </HoverTip>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Paper>
  );
};

export const ShareStatsSkeleton = () => (
  <Paper
    radius="md"
    p={{ base: "xs", sm: "sm" }}
    mt="md"
    withBorder
    aria-hidden
  >
    <Group position="apart" align="center" spacing="md">
      <Group spacing="xs" align="center" noWrap>
        <Skeleton height={28} width={28} radius="sm" />
        <Skeleton height={12} width={110} radius="sm" />
      </Group>
      <Skeleton height={20} width={42} radius="sm" />
    </Group>
    <Divider my={4} />
    <SimpleGrid
      cols={1}
      spacing={4}
      breakpoints={[
        { minWidth: "sm", cols: 2 },
        { minWidth: "md", cols: 3 },
      ]}
    >
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} height={38} radius="sm" />
      ))}
    </SimpleGrid>
  </Paper>
);

export default ShareStats;
