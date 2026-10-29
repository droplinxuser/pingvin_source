import { Button, MantineSize, Text } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useState } from "react";
import { TbDownload } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";

const DOWNLOAD_GAP_MS = 1000;
const MODAL_SETTLE_MS = 400;
// Fallback when the config key is not present yet (e.g. an older backend).
const DEFAULT_MAX_ZIP_SIZE = 512_000_000;

type DownloadableFile = { id: string; name: string; size?: string };

const DownloadAllButton = ({
  shareId,
  recipientId,
  files,
  labelId = "share.button.download-all",
  size,
}: {
  shareId: string;
  recipientId?: string;
  files: DownloadableFile[];
  labelId?: string;
  size?: MantineSize;
}) => {
  const config = useConfig();
  const modals = useModals();
  const t = useTranslate();
  const [isDownloading, setIsDownloading] = useState(false);

  let maxZipSize = DEFAULT_MAX_ZIP_SIZE;
  try {
    const configured = parseInt(config.get("share.maxZipSize") || "");
    if (Number.isFinite(configured)) maxZipSize = configured;
  } catch {
    // Keep the safe default if the key is unavailable.
  }

  const totalSize = files.reduce(
    (sum, file) => sum + (parseInt(file.size ?? "") || 0),
    0,
  );
  // A small, fully-measured selection becomes one streamed ZIP. Everything
  // else keeps the reliable per-file sequence.
  const useZip =
    files.length > 1 &&
    totalSize > 0 &&
    (maxZipSize <= 0 || totalSize <= maxZipSize);

  const downloadAll = async () => {
    setIsDownloading(true);
    try {
      // Let the confirmation modal finish closing before the first download.
      await new Promise((resolve) => setTimeout(resolve, MODAL_SETTLE_MS));
      if (useZip) {
        await shareService.downloadZip(
          shareId,
          recipientId,
          files.map((file) => file.id),
        );
        return;
      }
      for (const [index, file] of files.entries()) {
        await shareService.downloadFile(
          shareId,
          file.id,
          recipientId,
          file.name,
        );
        if (index < files.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_GAP_MS));
        }
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const confirmDownloadAll = () => {
    modals.openConfirmModal({
      title: t("share.custom.download-all.confirm.title"),
      children: (
        <Text size="sm">
          <FormattedMessage
            id={
              useZip
                ? "share.custom.download-all.confirm.zip-description"
                : "share.custom.download-all.confirm.description"
            }
            values={{ count: files.length }}
          />
        </Text>
      ),
      labels: {
        confirm: t(
          useZip
            ? "share.custom.download-all.confirm.zip-button"
            : "share.custom.download-all.confirm.button",
        ),
        cancel: t("common.button.cancel"),
      },
      onConfirm: downloadAll,
    });
  };

  return (
    <Button
      variant="light"
      // cyan.9 keeps the light variant but reaches WCAG AA on the cyan tint.
      color="cyan.9"
      size={size}
      leftIcon={<TbDownload />}
      loading={isDownloading}
      onClick={confirmDownloadAll}
    >
      <FormattedMessage id={labelId} />
    </Button>
  );
};

export default DownloadAllButton;
