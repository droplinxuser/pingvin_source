import { Button, Select, Stack, Text, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import useTranslate, {
  translateOutsideContext,
} from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import toast from "../../utils/toast.util";

const REPORT_REASONS = [
  "DMCA",
  "CSAM",
  "Gore",
  "Malware",
  "Spam",
  "Personal information",
  "Other",
] as const;

const showReportShareModal = (modals: ModalsContextProps, shareId: string) => {
  const t = translateOutsideContext();
  return modals.openModal({
    title: t("share.report.modal.title"),
    children: <Body shareId={shareId} />,
  });
};

const Body = ({ shareId }: { shareId: string }) => {
  const modals = useModals();
  const t = useTranslate();
  const [loading, setLoading] = useState(false);
  const form = useForm({
    initialValues: { reason: null as string | null, message: "" },
    validate: {
      reason: (value) =>
        value ? null : t("share.report.modal.error.no-reason"),
      message: (value, values) =>
        values.reason === "Other" && !value.trim()
          ? t("share.report.modal.error.no-message")
          : null,
    },
  });

  const reasonOptions = REPORT_REASONS.map((value) => ({
    value,
    label: t(`share.report.reason.${value.toLowerCase().replace(/ /g, "-")}`),
  }));

  const submit = form.onSubmit(async (values) => {
    setLoading(true);
    try {
      await shareService.report(
        shareId,
        values.reason!,
        values.message.trim() || undefined,
      );
      modals.closeAll();
      toast.success(t("share.report.notify.success"));
    } catch (e) {
      toast.axiosError(e);
    } finally {
      setLoading(false);
    }
  });

  return (
    <Stack align="stretch">
      <Text size="sm">
        <FormattedMessage id="share.report.modal.description" />
      </Text>
      <form onSubmit={submit}>
        <Stack>
          <Select
            variant="filled"
            label={t("share.report.modal.reason")}
            placeholder={t("share.report.modal.reason")}
            data={reasonOptions}
            {...form.getInputProps("reason")}
          />
          <Textarea
            variant="filled"
            label={t("share.report.modal.custom-reason")}
            placeholder={t("share.report.modal.custom-reason")}
            autosize
            minRows={3}
            maxLength={2000}
            {...form.getInputProps("message")}
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
