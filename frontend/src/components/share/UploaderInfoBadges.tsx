import { Group, Stack, Text, Tooltip } from "@mantine/core";
import moment from "moment";
import { useIntl } from "react-intl";
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
  const client = [
    [info?.browser, info?.browserVersion].filter(Boolean).join(" "),
    [info?.os, info?.osVersion].filter(Boolean).join(" "),
    info?.deviceType,
  ]
    .filter(Boolean)
    .join(" · ");
  const uploadedAt =
    info?.createdAt && moment(info.createdAt).isValid()
      ? moment(info.createdAt).format("LL")
      : undefined;
  const details = [
    client,
    info?.isp && `${t("share.uploader.isp")}: ${info.isp}`,
    info?.asn && `${t("share.uploader.asn")}: AS${info.asn}`,
    info?.timezone && `${t("share.uploader.timezone")}: ${info.timezone}`,
    uploadedAt && t("share.uploader.uploaded-at", { date: uploadedAt }),
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
          events={{ hover: true, focus: true, touch: true }}
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
          <Text
            size="sm"
            color="dimmed"
            sx={{ cursor: "help" }}
            aria-label={t("share.uploader.location")}
          >
            {info.country ? countryCodeToFlag(info.country) : "🌐"}{" "}
            {location || t("share.uploader.unknown")}
          </Text>
        </Tooltip>
      )}
    </Group>
  );
};

export default UploaderInfoBadges;
