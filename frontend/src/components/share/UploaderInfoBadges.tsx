import { Group, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import moment from "moment";
import { useIntl } from "react-intl";
import type { IconType } from "react-icons";
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
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { HoverTip } from "../core/HoverTip";
import UserAvatar from "../core/UserAvatar";

const ICON_SIZE = 16;
const UNKNOWN_ICON_COLOR = "#868E96";
const ICONS: Record<string, { Icon: IconType; color: string }> = {
  Windows: { Icon: FaWindows, color: "#0078D4" },
  macOS: { Icon: FaApple, color: "#8E8E93" },
  Linux: { Icon: FaLinux, color: "#E5A50A" },
  Android: { Icon: FaAndroid, color: "#3DDC84" },
  iOS: { Icon: SiIos, color: "#8E8E93" },
  ChromeOS: { Icon: FaChrome, color: "#4285F4" },
  Chrome: { Icon: FaChrome, color: "#4285F4" },
  Firefox: { Icon: FaFirefox, color: "#FF7139" },
  Safari: { Icon: FaSafari, color: "#006CFF" },
  Edge: { Icon: FaEdge, color: "#0078D4" },
  Opera: { Icon: FaOpera, color: "#FF1B2D" },
  Brave: { Icon: SiBrave, color: "#FB542B" },
};

const renderIcon = (name: string | undefined, Fallback: IconType) => {
  const entry = ICONS[name ?? ""];
  const Icon = entry?.Icon ?? Fallback;
  return (
    <Icon
      size={ICON_SIZE}
      color={entry?.color ?? UNKNOWN_ICON_COLOR}
      // The surrounding badge carries the translated label; the brand glyph is
      // decorative and should not become a separate image node.
      aria-hidden
    />
  );
};

export const getOsIcon = (os?: string) => renderIcon(os, TbDeviceLaptop);

export const getBrowserIcon = (browser?: string) =>
  renderIcon(browser, TbBrowser);

export const iconStyle = {
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
  const compactTooltip = useMediaQuery("(max-width: 767px)");
  const creator = share.creator?.displayName || share.creator?.username;
  const country = info?.country
    ? getCountryName(info.country, intl.locale)
    : undefined;
  const location = [info?.city, info?.region, country]
    .filter(Boolean)
    .join(", ");
  const uploadedAtValue =
    info?.createdAt && moment(info.createdAt).isValid()
      ? moment(info.createdAt)
      : undefined;
  const uploadedAt = uploadedAtValue
    ? `${uploadedAtValue.fromNow()} · ${uploadedAtValue.format("LL · LTS")}`
    : undefined;
  const details = [
    location,
    info?.timezone &&
      `${t("share.custom.uploader.timezone")}: ${info.timezone}`,
    uploadedAt && t("share.custom.uploader.uploaded-at", { date: uploadedAt }),
  ].filter(Boolean) as string[];
  const osLabel = `${info?.os || t("share.custom.uploader.unknown")}${
    info?.osVersion ? ` ${info.osVersion}` : ""
  }${info?.deviceType ? ` · ${info.deviceType}` : ""}`;
  const browserLabel = `${info?.browser || t("share.custom.uploader.unknown")}${
    info?.browserVersion ? ` ${info.browserVersion}` : ""
  }`;

  const badges = [
    {
      label: t("share.custom.uploader.country"),
      tooltip: (
        <Stack spacing={0} sx={{ maxWidth: 280 }}>
          {(details.length > 0
            ? details
            : [t("share.custom.uploader.unknown")]
          ).map((line) => (
            <Text key={line} size="xs" lh={1.2}>
              {line}
            </Text>
          ))}
        </Stack>
      ),
      icon: info?.country ? (
        countryCodeToFlag(info.country)
      ) : (
        <TbWorld size={ICON_SIZE} color={UNKNOWN_ICON_COLOR} />
      ),
      // Place the wide country card to the right of the badge row; the small
      // OS/browser cards only need to clear the icons that follow them.
      offset: 44,
    },
    {
      label: t("share.custom.uploader.os"),
      tooltip: osLabel,
      icon: getOsIcon(info?.os),
      offset: 22,
    },
    {
      label: t("share.custom.uploader.browser"),
      tooltip: browserLabel,
      icon: getBrowserIcon(info?.browser),
      offset: 10,
    },
  ];

  return (
    <Group spacing={6}>
      {share.creator && (
        <UserAvatar user={share.creator} size={20} aria-hidden />
      )}
      <Text size="sm" color="dimmed">
        {creator
          ? t("share.custom.uploader.by", { name: creator })
          : t("share.custom.uploader.anonymous")}
      </Text>
      {badges.map(({ label, tooltip, icon, offset }) => (
        <HoverTip
          key={label}
          label={tooltip}
          position={compactTooltip ? "top" : "right"}
          offset={compactTooltip ? 8 : offset}
        >
          <span role="img" style={iconStyle} aria-label={label}>
            {icon}
          </span>
        </HoverTip>
      ))}
    </Group>
  );
};

export default UploaderInfoBadges;
