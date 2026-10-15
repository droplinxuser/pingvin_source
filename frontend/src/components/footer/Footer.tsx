import { Anchor, Footer as MFooter, SimpleGrid, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, { SystemStats } from "../../services/system.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

const Footer = () => {
  const t = useTranslate();
  const config = useConfig();
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    systemService
      .getSystemStats()
      .then(setStats)
      .catch(() => {});
  }, []);

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

  return (
    <MFooter height="auto" py={6} px="xl" zIndex={100}>
      {stats && (
        <Text size="xs" color="dimmed" align="center" mb={2}>
          {[
            t("footer.stats.users", { count: stats.userCount }),
            t("footer.stats.shares", { count: stats.shareCount }),
            t("footer.stats.files", { count: stats.fileCount }),
            t("footer.stats.storage", {
              size: byteToHumanSizeString(stats.storageSizeBytes),
            }),
          ].join(" • ")}
        </Text>
      )}
      {!config.get("legal.enabled") && (
        <Text size="xs" color="dimmed" align="center">
          Contact{" "}
          <Anchor
            size="xs"
            href="https://phc.onl/contact"
            target="_blank"
          >
            for any inquiries
          </Anchor>
        </Text>
      )}
      {config.get("legal.enabled") && (
        <SimpleGrid cols={isMobile ? 2 : 3} m={0}>
          {!isMobile && <div></div>}
          <Text size="xs" color="dimmed" align={isMobile ? "left" : "center"}>
            Contact{" "}
            <Anchor
              size="xs"
              href="https://phc.onl/contact"
              target="_blank"
            >
              for any inquiries
            </Anchor>
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
