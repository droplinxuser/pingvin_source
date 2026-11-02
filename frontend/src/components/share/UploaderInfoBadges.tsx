import { Group, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import moment from "moment";
import { useIntl } from "react-intl";
import { TbWorld } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { Share, UploaderInfo } from "../../types/share.type";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import {
  getBrowserIcon,
  getOsIcon,
  iconStyle,
} from "../../utils/platformIcons";
import { HoverTip } from "../core/HoverTip";
import UserAvatar from "../core/UserAvatar";

const ICON_SIZE = 16;
const UNKNOWN_ICON_COLOR = "#868E96";

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
  const uploadedAtValue =
    info?.createdAt && moment(info.createdAt).isValid()
      ? moment(info.createdAt)
      : undefined;
  const uploadedAt = uploadedAtValue
    ? `${uploadedAtValue.fromNow()} · ${uploadedAtValue.format("LL · LTS")}`
    : undefined;
  const details = [
    country,
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
