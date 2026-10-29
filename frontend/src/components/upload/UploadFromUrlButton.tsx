import { Button, Modal, Stack, Text, TextInput } from "@mantine/core";
import { FormEvent, useState } from "react";
import { TbLink } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import { FileUpload } from "../../types/File.type";
import toast from "../../utils/toast.util";

const resolveRemoteName = (url: URL): string => {
  const segment = url.pathname.split("/").filter(Boolean).pop();
  if (segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }
  return "download";
};

/**
 * Queues a file that the backend will fetch from a URL. The fetch is performed
 * server-side (with SSRF protections) once the share exists, so hosts without
 * CORS headers work too. The entry carries `remoteUrl` and is uploaded by the
 * normal flow instead of the chunked browser upload.
 */
const UploadFromUrlButton = ({
  onFiles,
  disabled,
}: {
  onFiles: (files: FileUpload[]) => void;
  disabled?: boolean;
}) => {
  const t = useTranslate();
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return;

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      toast.error(t("upload.url.error.invalid"));
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      toast.error(t("upload.url.error.invalid"));
      return;
    }

    const name = resolveRemoteName(url);
    const file = new File([], name) as FileUpload;
    file.uploadingProgress = 0;
    file.remoteUrl = url.toString();

    onFiles([file]);
    toast.success(t("upload.url.notify.added", { name }));
    setValue("");
    setOpened(false);
  };

  return (
    <>
      <Button
        variant="light"
        size="sm"
        radius="xl"
        leftIcon={<TbLink size={16} />}
        disabled={disabled}
        onClick={() => setOpened(true)}
      >
        <FormattedMessage id="upload.url.button" />
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={t("upload.url.title")}
        centered
      >
        <form onSubmit={submit}>
          <Stack spacing="sm">
            <TextInput
              data-autofocus
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder={t("upload.url.placeholder")}
              aria-label={t("upload.url.title")}
            />
            <Text size="xs" color="dimmed">
              <FormattedMessage id="upload.url.hint" />
            </Text>
            <Button type="submit">
              <FormattedMessage id="upload.url.add" />
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
};

export default UploadFromUrlButton;
