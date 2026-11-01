import {
  Box,
  createStyles,
  Group,
  Paper,
  SimpleGrid,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import {
  TbClockHour4,
  TbDownload,
  TbEye,
  TbFile,
  TbPlayerPlay,
} from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import type { StatShare } from "../../types/stats.type";
import {
  getShareThumbnailUrl,
  handleShareThumbnailError,
} from "../../utils/file.util";
import { getCompactNumberFormat } from "../../utils/number.util";
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
      height: "100%",
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
      color: muted,
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

const RankedSharePanel = ({
  titleId,
  title,
  description,
  windowLabel,
  icon,
  items,
  metric,
  empty,
}: {
  titleId: string;
  title: string;
  description: string;
  windowLabel: string;
  icon: ReactNode;
  items: StatShare[];
  metric: "views" | "downloads";
  empty: string;
}) => {
  const { classes } = useStyles();
  const t = useTranslate();
  const intl = useIntl();
  const compact = getCompactNumberFormat(intl.locale);
  const MetricIcon = metric === "views" ? TbEye : TbDownload;

  return (
    <Paper
      component="section"
      withBorder
      radius="md"
      className={classes.root}
      aria-labelledby={titleId}
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
          <Box className={classes.headingIcon}>{icon}</Box>
          <Box sx={{ minWidth: 0 }}>
            <Title order={2} id={titleId} className={classes.heading}>
              {title}
            </Title>
            <Text className={classes.subheading}>{description}</Text>
          </Box>
        </Group>
        <Text className={classes.window}>
          <TbClockHour4 size={13} aria-hidden />
          {windowLabel}
        </Text>
      </Group>

      {items.length === 0 ? (
        <Text size="sm" color="dimmed" py="sm">
          {empty}
        </Text>
      ) : (
        <SimpleGrid
          cols={2}
          spacing="xs"
          verticalSpacing="xs"
          className={classes.list}
          breakpoints={[{ maxWidth: "sm", cols: 1 }]}
        >
          {items.slice(0, 20).map((item, index) => {
            const label = item.name || item.id;
            const value = metric === "views" ? item.views : item.downloads;
            const rawValue = value ?? 0;
            const metricLabel =
              rawValue < 1000
                ? t(
                    metric === "views"
                      ? "stats.custom.views"
                      : "stats.custom.downloads",
                    { count: rawValue },
                  )
                : t(
                    metric === "views"
                      ? "stats.custom.viewsCompact"
                      : "stats.custom.downloadsCompact",
                    { count: compact.format(rawValue) },
                  );
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
                  {item.previewFileId ? (
                    <LazyImage
                      className={classes.thumbImage}
                      src={getShareThumbnailUrl(item.id, item.updatedAt)}
                      alt=""
                      onError={handleShareThumbnailError}
                    />
                  ) : (
                    <TbFile size={17} aria-hidden />
                  )}
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
                    <MetricIcon size={12} aria-hidden />
                    {metricLabel}
                  </Box>
                </Box>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}
    </Paper>
  );
};

export default RankedSharePanel;
