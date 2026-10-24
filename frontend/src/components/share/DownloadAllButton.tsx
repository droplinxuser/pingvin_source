import { Button, Text } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useState } from "react";
import { TbDownload } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";

const DOWNLOAD_GAP_MS = 250;
const MODAL_SETTLE_MS = 400;

type DownloadableFile = { id: string };

const DownloadAllButton = ({
  shareId,
  recipientId,
  files,
}: {
  shareId: string;
  recipientId?: string;
  files: DownloadableFile[];
}) => {
  const modals = useModals();
  const t = useTranslate();
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadAll = async () => {
    setIsDownloading(true);
    try {
      // Let the confirmation modal finish closing before the first download.
      await new Promise((resolve) => setTimeout(resolve, MODAL_SETTLE_MS));
      for (const [index, file] of files.entries()) {
        await shareService.downloadFile(shareId, file.id, recipientId);
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
            id="share.custom.download-all.confirm.description"
            values={{ count: files.length }}
          />
        </Text>
      ),
      labels: {
        confirm: t("share.custom.download-all.confirm.button"),
        cancel: t("common.button.cancel"),
      },
      onConfirm: downloadAll,
    });
  };

  return (
    <Button
      variant="light"
      color="cyan"
      leftIcon={<TbDownload />}
      loading={isDownloading}
      onClick={confirmDownloadAll}
    >
      <FormattedMessage id="share.button.download-all" />
    </Button>
  );
};

export default DownloadAllButton;
