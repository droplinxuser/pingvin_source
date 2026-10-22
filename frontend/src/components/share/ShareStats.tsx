import {
  Badge,
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
import {
  countryCodeToFlag,
  getBrowserIcon,
  getCountryName,
  getOsIcon,
} from "./UploaderInfoBadges";

const MAX_VISITORS = 20;

const iconStyle = {
  display: "inline-flex",
  alignItems: "center",
  opacity: 0.85,
} as const;

const ShareStats = ({ share }: { share: Share }) => {
  const t = useTranslate();
  const intl = useIntl();
  const visitors = [...(share.uploaderInfo?.visitors ?? [])].reverse();
  const views = share.views ?? 0;

  return (
    <Paper radius="md" p="sm" mt="lg" withBorder>
      <Group position="apart" align="center" spacing="md">
        <Group spacing="xs" align="center" noWrap>
          <ThemeIcon size={34} radius="sm" variant="light">
            <TbActivity size={18} />
          </ThemeIcon>
          <Text size="md" weight={700} lh={1.2}>
            {t("share.custom.stats.title")}
          </Text>
        </Group>
        <Group spacing={8} align="baseline" noWrap>
          <Text size="xs" color="dimmed" weight={600} tt="uppercase">
            {t("share.custom.stats.views")}
          </Text>
          <Text size={22} weight={800} lh={1}>
            {views.toLocaleString(intl.locale)}
          </Text>
        </Group>
      </Group>

      <Divider my="sm" />

      <Group position="apart" mb={6}>
        <Text size="sm" weight={600}>
          {t("share.custom.stats.recent")}
        </Text>
        <Badge size="xs" radius="sm" variant="light">
          {visitors.length}/{MAX_VISITORS}
        </Badge>
      </Group>

      {visitors.length === 0 ? (
        <Box py={6}>
          <Text size="sm" color="dimmed" align="center">
            {t("share.custom.stats.empty")}
          </Text>
        </Box>
      ) : (
        <SimpleGrid
          cols={1}
          spacing="xs"
          breakpoints={[{ minWidth: "sm", cols: 2 }]}
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
                py={7}
                withBorder
              >
                <Group position="apart" align="center" noWrap spacing="xs">
                  <Group spacing={8} noWrap sx={{ minWidth: 0, flex: 1 }}>
                    <Text size="lg" aria-hidden>
                      {countryCodeToFlag(visitor.country)}
                    </Text>
                    <Box sx={{ minWidth: 0 }}>
                      <Text size="sm" weight={600} truncate lh={1.3}>
                        {location}
                      </Text>
                      <Text size="xs" color="dimmed" truncate lh={1.3}>
                        {moment(visitor.createdAt).fromNow()} ·{" "}
                        {visitor.referrer
                          ? t("share.custom.stats.via", {
                              domain: visitor.referrer,
                            })
                          : t("share.custom.stats.direct")}
                      </Text>
                    </Box>
                  </Group>
                  <Group spacing={4} noWrap>
                    <HoverTip
                      label={visitor.os || t("share.custom.uploader.unknown")}
                    >
                      <span
                        style={iconStyle}
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
                        style={iconStyle}
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
