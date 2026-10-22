import {
  Badge,
  Box,
  Card,
  createStyles,
  Divider,
  Group,
  Paper,
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

const useStyles = createStyles((theme) => ({
  panel: {
    position: "relative",
    background:
      theme.colorScheme === "dark"
        ? `linear-gradient(145deg, ${theme.colors.dark[6]} 0%, ${theme.colors.dark[7]} 100%)`
        : `linear-gradient(145deg, ${theme.white} 0%, ${theme.colors.gray[0]} 100%)`,
  },

  visitor: {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.fn.rgba(theme.colors.dark[5], 0.55)
        : theme.fn.rgba(theme.white, 0.75),
    transition: "transform 160ms ease, border-color 160ms ease",
    "&:hover": {
      transform: "translateY(-1px)",
      borderColor:
        theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 6 : 5],
    },
  },

  flag: {
    fontSize: 20,
    lineHeight: 1,
    fontFamily:
      "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, Twemoji Mozilla, sans-serif",
  },
}));

const MAX_VISITORS = 20;

const iconStyle = {
  display: "inline-flex",
  alignItems: "center",
  opacity: 0.85,
} as const;

const ShareStats = ({ share }: { share: Share }) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const visitors = [...(share.uploaderInfo?.visitors ?? [])].reverse();
  const views = share.views ?? 0;

  return (
    <Paper className={classes.panel} radius="md" p="sm" mt="lg" withBorder>
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
        <Box
          sx={(theme) => ({
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(min(100%, 290px), 1fr))",
            gap: theme.spacing.xs,
          })}
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
                className={classes.visitor}
                radius="sm"
                px="xs"
                py={7}
                withBorder
              >
                <Group position="apart" align="center" noWrap spacing="xs">
                  <Group spacing={8} noWrap sx={{ minWidth: 0, flex: 1 }}>
                    <Text className={classes.flag} aria-hidden>
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
        </Box>
      )}
    </Paper>
  );
};

export default ShareStats;
