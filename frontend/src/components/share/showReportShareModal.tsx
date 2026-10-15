import { Button, Select, Stack, Text, Textarea } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import useTranslate, {
  translateOutsideContext,
} from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import toast from "../../utils/toast.util";

export const REPORT_REASONS = [
  "DMCA",
  "CSAM",
  "Gore",
  "Malware",
  "Spam",
  "Personal information",
  "Other",
] as const;

export const REPORT_OTHER = "Other";

const showReportShareModal = (
  modals: ModalsContextProps,
  shareId: string,
) => {
  const t = translateOutsideContext();
  return modals.openModal({
    title: t("share.report.modal.title"),
    children: <Body shareId={shareId} />,
  });
};

const Body = ({ shareId }: { shareId: string }) => {
  const modals = useModals();
  const t = useTranslate();
  const [reason, setReason] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [messageError, setMessageError] = useState(false);
  const [loading, setLoading] = useState(false);

  const reasonOptions = REPORT_REASONS.map((value) => ({
    value,
    label: t(`share.report.reason.${value.toLowerCase().replace(/ /g, "-")}`),
  }));

  const submit = async () => {
    const reasonMissing = !reason;
    const messageMissing = reason === REPORT_OTHER && !message.trim();
    setReasonError(reasonMissing);
    setMessageError(messageMissing);
    if (reasonMissing || messageMissing) return;

    setLoading(true);
    try {
      await shareService.report(shareId, reason!, message.trim() || undefined);
      modals.closeAll();
      toast.success(t("share.report.notify.success"));
    } catch (e) {
      toast.axiosError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack align="stretch">
      <Text size="sm">
        <FormattedMessage id="share.report.modal.description" />
      </Text>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Stack>
          <Select
            variant="filled"
            label={t("share.report.modal.reason")}
            placeholder={t("share.report.modal.reason")}
            data={reasonOptions}
            value={reason}
            onChange={(value) => {
              setReason(value);
              setReasonError(false);
            }}
            error={reasonError && t("share.report.modal.error.no-reason")}
          />
          <Textarea
            variant="filled"
            label={t("share.report.modal.custom-reason")}
            placeholder={t("share.report.modal.custom-reason")}
            autosize
            minRows={3}
            maxLength={2000}
            value={message}
            onChange={(e) => {
              setMessage(e.currentTarget.value);
              setMessageError(false);
            }}
            error={messageError && t("share.report.modal.error.no-message")}
          />
          <Button type="submit" loading={loading}>
            <FormattedMessage id="common.button.submit" />
          </Button>
        </Stack>
      </form>
    </Stack>
  );
};

export default showReportShareModal;
