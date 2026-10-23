import { Button } from "@mantine/core";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import shareService from "../../services/share.service";

const DownloadAllButton = ({
  shareId,
  recipientId,
  isZipReady: initialIsZipReady = false,
}: {
  shareId: string;
  recipientId?: string;
  isZipReady?: boolean;
}) => {
  const [isZipReady, setIsZipReady] = useState(initialIsZipReady);
  const [isLoading, setIsLoading] = useState(false);

  const downloadAll = async () => {
    setIsLoading(true);
    await shareService
      .downloadFile(shareId, "zip", recipientId)
      .then(() => setIsLoading(false));
  };

  useEffect(() => {
    // The share response already carries the zip state, so only poll while it
    // is still being prepared.
    if (initialIsZipReady) {
      setIsZipReady(true);
      return;
    }

    const timer = setInterval(() => {
      shareService
        .getMetaData(shareId)
        .then((share) => {
          setIsZipReady(share.isZipReady);
          if (share.isZipReady) clearInterval(timer);
        })
        .catch(() => clearInterval(timer));
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [initialIsZipReady, shareId]);

  // The button is only shown once the zip has been prepared
  if (!isZipReady) return null;

  return (
    <Button
      variant="light"
      color="cyan"
      loading={isLoading}
      onClick={downloadAll}
    >
      <FormattedMessage id="share.button.download-all" />
    </Button>
  );
};

export default DownloadAllButton;
