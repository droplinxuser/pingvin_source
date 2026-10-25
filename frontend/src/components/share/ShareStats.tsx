import {
  Box,
  Card,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Text,
  ThemeIcon,
} from "@mantine/core";
import moment from "moment";
import { useIntl } from "react-intl";
import { TbActivity } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { Share } from "../../types/share.type";
import { HoverTip } from "../core/HoverTip";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { getBrowserIcon, getOsIcon, iconStyle } from "./UploaderInfoBadges";

const ShareStats = ({ share }: { share: Share }) => {
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
        <Group spacing={6} align="baseline" noWrap>
          <Text size="xs" color="dimmed" weight={600} tt="uppercase">
            {t("share.custom.stats.views")}
          </Text>
          <Text size={20} weight={800} lh={1}>
            {views.toLocaleString(intl.locale)}
          </Text>
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
                    <Text size="sm" aria-hidden>
                      {countryCodeToFlag(visitor.country)}
                    </Text>
                    <Text size="xs" weight={600} truncate lh={1.3}>
                      {location}
                    </Text>
                    <HoverTip
                      label={
                        visitor.referrer
                          ? t("share.custom.stats.via", {
                              domain: visitor.referrer,
                            })
                          : t("share.custom.stats.direct")
                      }
                    >
                      <Text
                        size="xs"
                        color="dimmed"
                        lh={1.3}
                        sx={{ whiteSpace: "nowrap" }}
                      >
                        {moment(visitor.createdAt).fromNow()}
                      </Text>
                    </HoverTip>
                  </Group>
                  <Group spacing={2} noWrap>
                    <HoverTip
                      label={visitor.os || t("share.custom.uploader.unknown")}
                    >
                      <span
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

export default ShareStats;
