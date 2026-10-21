import { Group, Stack, Text, Tooltip } from "@mantine/core";
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

const countryCodeToFlag = (code: string) =>
  /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(
        ...Array.from(code).map((char) => 127397 + char.charCodeAt(0)),
      )
    : "🌐";

const getCountryName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const continentNames: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
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

const iconWrapperStyle = {
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
  const countryName = info?.country
    ? getCountryName(info.country, intl.locale)
    : undefined;
  const continentName = info?.continent
    ? continentNames[info.continent] || info.continent
    : undefined;
  const coordinates =
    info?.latitude && info?.longitude
      ? `${info.latitude}, ${info.longitude}`
      : undefined;
  const uploadedAt =
    info?.createdAt && moment(info.createdAt).isValid()
      ? moment(info.createdAt).format("LL")
      : undefined;

  const locationDetails = [
    countryName,
    info?.city && `${info.city}${info.region ? `, ${info.region}` : ""}`,
    continentName && `${t("share.uploader.continent")}: ${continentName}`,
    info?.isp && `${t("share.uploader.isp")}: ${info.isp}`,
    info?.asn && `${t("share.uploader.asn")}: AS${info.asn}`,
    info?.ip && `${t("share.uploader.ip")}: ${info.ip}`,
    info?.timezone && `${t("share.uploader.timezone")}: ${info.timezone}`,
    coordinates && `${t("share.uploader.coordinates")}: ${coordinates}`,
    info?.deviceType && `${t("share.uploader.device")}: ${info.deviceType}`,
  ].filter(Boolean) as string[];

  return (
    <Group spacing={6}>
      <Text size="sm" color="dimmed">
        {creator
          ? t("share.uploader.by", { name: creator })
          : t("share.uploader.anonymous")}
      </Text>

      {info && (
        <Tooltip
          position="bottom"
          withArrow
          label={
            <Stack spacing={2} sx={{ maxWidth: 280 }}>
              {locationDetails.length > 0 ? (
                locationDetails.map((line, index) => (
                  <Text key={`${index}-${line}`} size="xs">
                    {line}
                  </Text>
                ))
              ) : (
                <Text size="xs">{t("share.uploader.unknown")}</Text>
              )}
            </Stack>
          }
          events={{ hover: true, focus: true, touch: true }}
        >
          <span
            style={{ ...iconWrapperStyle, fontSize: 16, lineHeight: 1 }}
            aria-label={t("share.uploader.location")}
          >
            {info.country ? (
              countryCodeToFlag(info.country)
            ) : (
              <TbWorld size={16} />
            )}
          </span>
        </Tooltip>
      )}

      {info && (
        <Tooltip
          position="bottom"
          withArrow
          label={`${info.os || t("share.uploader.unknown")}${
            info.osVersion ? ` ${info.osVersion}` : ""
          }`}
          events={{ hover: true, focus: true, touch: true }}
        >
          <span style={iconWrapperStyle} aria-label={t("share.uploader.os")}>
            {getOsIcon(info.os)}
          </span>
        </Tooltip>
      )}

      {info && (
        <Tooltip
          position="bottom"
          withArrow
          label={`${info.browser || t("share.uploader.unknown")}${
            info.browserVersion ? ` ${info.browserVersion}` : ""
          }`}
          events={{ hover: true, focus: true, touch: true }}
        >
          <span
            style={iconWrapperStyle}
            aria-label={t("share.uploader.browser")}
          >
            {getBrowserIcon(info.browser)}
          </span>
        </Tooltip>
      )}

      {uploadedAt && (
        <Text size="sm" color="dimmed">
          {t("share.uploader.uploaded-at", { date: uploadedAt })}
        </Text>
      )}
    </Group>
  );
};

export default UploaderInfoBadges;
