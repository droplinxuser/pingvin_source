import { Anchor, Footer as MFooter, SimpleGrid, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, { SystemStats } from "../../services/system.service";
import { countryCodeToFlag, getCountryName } from "../../utils/country.util";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

const Footer = () => {
  const t = useTranslate();
  const intl = useIntl();
  const router = useRouter();
  const config = useConfig();
  const [stats, setStats] = useState<SystemStats | null>(null);

  // This is also the page-view beacon: one POST per rendered page, with the
  // counters kept in Valkey instead of SQLite.
  useEffect(() => {
    systemService
      .recordPageView()
      .then(setStats)
      .catch(() =>
        systemService
          .getSystemStats()
          .then(setStats)
          .catch(() => {}),
      );
  }, [router.asPath]);

  const hasImprint = !!(
    config.get("legal.imprintUrl") || config.get("legal.imprintText")
  );
  const hasPrivacy = !!(
    config.get("legal.privacyPolicyUrl") ||
    config.get("legal.privacyPolicyText")
  );
  const imprintUrl =
    (!config.get("legal.imprintText") && config.get("legal.imprintUrl")) ||
    "/imprint";
  const privacyUrl =
    (!config.get("legal.privacyPolicyText") &&
      config.get("legal.privacyPolicyUrl")) ||
    "/privacy";

  const isMobile = useMediaQuery("(max-width: 700px)");
  const contact = (
    <>
      Questions?{" "}
      <Anchor size="xs" href="mailto:contactwebph@gmail.com">
        contactwebph@gmail.com
      </Anchor>
    </>
  );

  return (
    <MFooter height="auto" py={6} px="xl" zIndex={100}>
      {stats && (
        <>
          <Text size="xs" color="dimmed" align="center" mb={2}>
            {t("footer.custom.stats.summary", {
              users: stats.userCount,
              shares: stats.shareCount,
              files: stats.fileCount,
              size: byteToHumanSizeString(stats.storageSizeBytes),
            })}
          </Text>
          <Text size="xs" color="dimmed" align="center" mb={2}>
            {t("footer.custom.stats.pageviews", {
              count: stats.pageViewsLastHour ?? 0,
            })}
            {stats.topCountriesLastHour?.length ? (
              <>
                {" · "}
                {t("footer.custom.stats.top-countries")}{" "}
                {stats.topCountriesLastHour.map(({ country, count }, index) => (
                  <span
                    key={country}
                    title={getCountryName(country, intl.locale)}
                  >
                    {index > 0 ? " · " : ""}
                    {countryCodeToFlag(country)} {count}
                  </span>
                ))}
              </>
            ) : null}
          </Text>
        </>
      )}
      {!config.get("legal.enabled") && (
        <Text size="xs" color="dimmed" align="center">
          {contact}
        </Text>
      )}
      {config.get("legal.enabled") && (
        <SimpleGrid cols={isMobile ? 2 : 3} m={0}>
          {!isMobile && <div></div>}
          <Text size="xs" color="dimmed" align={isMobile ? "left" : "center"}>
            {contact}
          </Text>
          <div>
            <Text size="xs" color="dimmed" align="right">
              {hasImprint && (
                <Anchor size="xs" href={imprintUrl}>
                  {t("imprint.title")}
                </Anchor>
              )}
              {hasImprint && hasPrivacy && " • "}
              {hasPrivacy && (
                <Anchor size="xs" href={privacyUrl}>
                  {t("privacy.title")}
                </Anchor>
              )}
            </Text>
          </div>
        </SimpleGrid>
      )}
    </MFooter>
  );
};

export default Footer;
