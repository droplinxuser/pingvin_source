import { Group, Stack, Text } from "@mantine/core";
import moment from "moment";
import { ReactNode } from "react";
import { useIntl } from "react-intl";
import {
  FaAndroid,
  FaApple,
  FaChrome,
  FaEdge,
  FaFirefox,
  FaLinux,
  FaOpera,
  FaSafari,
  FaWindows,
} from "react-icons/fa";
import { SiBrave, SiIos } from "react-icons/si";
import { TbBrowser, TbDeviceLaptop, TbWorld } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { Share, UploaderInfo } from "../../types/share.type";
import { HoverTip } from "../core/HoverTip";

const iconProps = { size: 16 };
const ICONS: Record<string, ReactNode> = {
  Windows: <FaWindows {...iconProps} />,
  macOS: <FaApple {...iconProps} />,
  Linux: <FaLinux {...iconProps} />,
  Android: <FaAndroid {...iconProps} />,
  iOS: <SiIos {...iconProps} />,
  ChromeOS: <FaChrome {...iconProps} />,
  Chrome: <FaChrome {...iconProps} />,
  Firefox: <FaFirefox {...iconProps} />,
  Safari: <FaSafari {...iconProps} />,
  Edge: <FaEdge {...iconProps} />,
  Opera: <FaOpera {...iconProps} />,
  Brave: <SiBrave {...iconProps} />,
};

const countryCodeToFlag = (code: string) =>
  /^[A-Z]{2}$/.test(code) && code !== "T1"
    ? String.fromCodePoint(
        ...Array.from(code).map((char) => 127397 + char.charCodeAt(0)),
      )
    : "🌐";

const getCountryName = (code: string, locale: string) => {
  if (code === "T1") return "Tor";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const iconStyle = {
  display: "inline-flex",
  alignItems: "center",
  cursor: "help",
} as const;

const UploaderInfoBadges = ({
  share,
  info,
}: {
  share: Share;
  info?: UploaderInfo;
}) => {
  const t = useTranslate();
  const intl = useIntl();
  const creator = share.creator?.displayName || share.creator?.username;
  const country = info?.country
    ? getCountryName(info.country, intl.locale)
    : undefined;
  const location = [info?.city, info?.region, country]
    .filter(Boolean)
    .join(", ");
  const uploadedAt =
    info?.createdAt && moment(info.createdAt).isValid()
      ? moment(info.createdAt).format("LL")
      : undefined;
  const details = [
    location,
    info?.timezone && `${t("share.uploader.timezone")}: ${info.timezone}`,
    uploadedAt && t("share.uploader.uploaded-at", { date: uploadedAt }),
  ].filter(Boolean) as string[];
  const osLabel = `${info?.os || t("share.uploader.unknown")}${
    info?.osVersion ? ` ${info.osVersion}` : ""
  }${info?.deviceType ? ` · ${info.deviceType}` : ""}`;
  const browserLabel = `${info?.browser || t("share.uploader.unknown")}${
    info?.browserVersion ? ` ${info.browserVersion}` : ""
  }`;

  return (
    <Group spacing={6}>
      <Text size="sm" color="dimmed">
        {creator
          ? t("share.uploader.by", { name: creator })
          : t("share.uploader.anonymous")}
      </Text>
      <HoverTip
        label={
          <Stack spacing={2} sx={{ maxWidth: 280 }}>
            {(details.length > 0 ? details : [t("share.uploader.unknown")]).map(
              (line) => (
                <Text key={line} size="xs">
                  {line}
                </Text>
              ),
            )}
          </Stack>
        }
      >
        <span style={iconStyle} aria-label={t("share.uploader.country")}>
          {info?.country ? (
            countryCodeToFlag(info.country)
          ) : (
            <TbWorld size={16} />
          )}
        </span>
      </HoverTip>
      <HoverTip label={osLabel}>
        <span style={iconStyle} aria-label={t("share.uploader.os")}>
          {ICONS[info?.os ?? ""] ?? <TbDeviceLaptop {...iconProps} />}
        </span>
      </HoverTip>
      <HoverTip label={browserLabel}>
        <span style={iconStyle} aria-label={t("share.uploader.browser")}>
          {ICONS[info?.browser ?? ""] ?? <TbBrowser {...iconProps} />}
        </span>
      </HoverTip>
    </Group>
  );
};

export default UploaderInfoBadges;
