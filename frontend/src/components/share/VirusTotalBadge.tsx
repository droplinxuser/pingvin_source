import { Text, ThemeIcon } from "@mantine/core";
import { FormattedMessage } from "react-intl";
import { TbShieldCheck, TbShieldExclamation } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import { VirusTotalFileReport } from "../../types/File.type";
import { HoverTip } from "../core/HoverTip";
import RelativeTime from "../core/RelativeTime";

/**
 * Small indicator for a VirusTotal-scanned file. A tooltip carries the engine
 * counts and the file hash. Shown only when the share's flat-file report has an
 * entry for the file (unscanned and removed files have none).
 */
const VirusTotalBadge = ({ report }: { report: VirusTotalFileReport }) => {
  const t = useTranslate();
  const suspicious = report.verdict === "suspicious";
  const label = suspicious
    ? t("share.custom.virustotal.suspicious")
    : t("share.custom.virustotal.safe");
  const hasCounts =
    report.malicious !== undefined ||
    report.suspicious !== undefined ||
    report.undetected !== undefined;
  const hash = report.hash ? report.hash.slice(0, 16) : undefined;

  return (
    <HoverTip
      label={
        <div>
          <Text size="xs" weight={700}>
            {label}
          </Text>
          {hasCounts && (
            <Text size="xs">
              <FormattedMessage
                id="share.custom.virustotal.summary"
                values={{
                  malicious: report.malicious ?? 0,
                  suspicious: report.suspicious ?? 0,
                  undetected: report.undetected ?? 0,
                }}
              />
            </Text>
          )}
          {hash && (
            <Text size="xs" sx={{ fontFamily: "monospace" }}>
              <FormattedMessage
                id="share.custom.virustotal.hash"
                values={{ hash }}
              />
            </Text>
          )}
          {report.scannedAt && (
            <Text size="xs">
              <FormattedMessage
                id="share.custom.virustotal.scanned"
                values={{ date: <RelativeTime date={report.scannedAt} /> }}
              />
            </Text>
          )}
        </div>
      }
    >
      <ThemeIcon
        variant="light"
        color={suspicious ? "orange" : "teal"}
        size={24}
        radius="xl"
        role="img"
        aria-label={label}
      >
        {suspicious ? (
          <TbShieldExclamation size={15} />
        ) : (
          <TbShieldCheck size={15} />
        )}
      </ThemeIcon>
    </HoverTip>
  );
};

export default VirusTotalBadge;
