import { ActionIcon, Button, Tooltip } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { TbShare3 } from "react-icons/tb";
import useSiteMeta from "../../hooks/siteMeta.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import toast from "../../utils/toast.util";

type ShareButtonProps = {
  url: string;
  title?: string;
  text?: string;
  compact?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
};

/**
 * Uses the native share sheet when the browser exposes it (mobile Chrome,
 * Safari, Edge; it includes WhatsApp, Telegram, SMS, email and installed
 * apps). Desktop browsers without Web Share fall back to copying the link.
 */
const ShareButton = ({
  url,
  title,
  text,
  compact = false,
  size = "sm",
}: ShareButtonProps) => {
  const t = useTranslate();
  const { siteName } = useSiteMeta();
  const clipboard = useClipboard({ timeout: 800 });
  const canNativeShare =
    typeof navigator !== "undefined" && "share" in navigator;

  const copyFallback = (message?: string) => {
    clipboard.copy(url);
    toast.success(message ?? t("common.notify.copied-link"));
  };

  const handleShare = async () => {
    const shareTitle = title || t("share.custom.share.title");
    const shareText = text || t("share.custom.share.text", { siteName });

    if (canNativeShare) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        return;
      } catch (error) {
        // The user closing the sheet is not an error and needs no fallback.
        if ((error as { name?: string })?.name === "AbortError") return;
      }
    }

    copyFallback(canNativeShare ? t("share.custom.share.copied") : undefined);
  };

  if (compact) {
    return (
      <Tooltip
        label={t("share.custom.share.button")}
        position="top"
        openDelay={200}
      >
        <ActionIcon
          onClick={handleShare}
          aria-label={t("share.custom.share.button")}
          size={size}
        >
          <TbShare3 />
        </ActionIcon>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="light"
      size={size}
      leftIcon={<TbShare3 />}
      onClick={handleShare}
    >
      {t("share.custom.share.button")}
    </Button>
  );
};

export default ShareButton;
