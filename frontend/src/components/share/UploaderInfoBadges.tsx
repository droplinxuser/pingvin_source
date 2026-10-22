import { Group, Stack, Text } from "@mantine/core";
import moment from "moment";
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

const getOsIcon = (os?: string) => {
  const props = { size: 16 };
  switch (os) {
    case "Windows":
      return <FaWindows {...props} />;
    case "macOS":
      return <FaApple {...props} />;
    case "Linux":
      return <FaLinux {...props} />;
    case "Android":
      return <FaAndroid {...props} />;
    case "iOS":
      return <SiIos {...props} />;
    case "ChromeOS":
      return <FaChrome {...props} />;
    default:
      return <TbDeviceLaptop {...props} />;
  }
};

const getBrowserIcon = (browser?: string) => {
  const props = { size: 16 };
  switch (browser) {
    case "Chrome":
      return <FaChrome {...props} />;
    case "Firefox":
      return <FaFirefox {...props} />;
    case "Safari":
      return <FaSafari {...props} />;
    case "Edge":
      return <FaEdge {...props} />;
    case "Opera":
      return <FaOpera {...props} />;
    case "Brave":
      return <SiBrave {...props} />;
    default:
      return <TbBrowser {...props} />;
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
            {details.length > 0 ? (
              details.map((line) => (
                <Text key={line} size="xs">
                  {line}
                </Text>
              ))
            ) : (
              <Text size="xs">{t("share.uploader.unknown")}</Text>
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
          {getOsIcon(info?.os)}
        </span>
      </HoverTip>
      <HoverTip label={browserLabel}>
        <span style={iconStyle} aria-label={t("share.uploader.browser")}>
          {getBrowserIcon(info?.browser)}
        </span>
      </HoverTip>
    </Group>
  );
};

export default UploaderInfoBadges;
