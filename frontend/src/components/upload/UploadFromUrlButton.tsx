import { Button, Modal, Stack, Text, TextInput } from "@mantine/core";
import { FormEvent, useState } from "react";
import { TbLink } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import { FileUpload } from "../../types/File.type";
import { classifyFileHost } from "../../utils/fileHost.util";
import toast from "../../utils/toast.util";
import { fetchRemoteAsFile, RemoteNotAFileError } from "../../utils/upload.util";

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
 * Queues a file from a URL. Direct URLs are downloaded by the visitor's browser
 * and added as a real file. Known hosts (file hosts such as MediaFire, Bunkr,
 * Dropbox, Google Drive, OneDrive, pCloud, Pixeldrain and tmpfiles, plus media
 * platforms such as YouTube and Vimeo) cannot be read cross-origin, so those
 * are resolved or extracted server side with SSRF protections. Known hosts we
 * cannot resolve are reported instead of being silently fetched.
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
  const [loading, setLoading] = useState(false);

  const close = () => {
    setValue("");
    setOpened(false);
  };

  const submit = async (event: FormEvent) => {
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

    const host = classifyFileHost(url.toString());

    // A known host we cannot resolve: say so instead of silently failing.
    if (host === "unsupported") {
      toast.error(t("upload.url.error.hostUnsupported"));
      return;
    }

    // Supported file-host pages are resolved and fetched by the backend.
    if (host === "server") {
      const name = resolveRemoteName(url);
      const file = new File([], name) as FileUpload;
      file.uploadingProgress = 0;
      file.remoteUrl = url.toString();
      file.remoteViaServer = true;

      onFiles([file]);
      toast.success(t("upload.url.notify.added", { name }));
      close();
      return;
    }

    // Every other URL is downloaded here, in the visitor's browser.
    setLoading(true);
    try {
      const file = (await fetchRemoteAsFile(
        url.toString(),
        resolveRemoteName(url),
      )) as FileUpload;
      file.uploadingProgress = 0;
      onFiles([file]);
      toast.success(t("upload.url.notify.added", { name: file.name }));
      close();
    } catch (error) {
      // A cross-origin (CORS) failure rejects with a TypeError before the body
      // can be read; an HTML response means the URL is a page, not a file;
      // anything else is a bad/unavailable link.
      toast.error(
        t(
          error instanceof RemoteNotAFileError
            ? "upload.url.error.notAFile"
            : error instanceof TypeError
              ? "upload.url.error.cors"
              : "upload.url.error.fetch",
        ),
      );
    } finally {
      setLoading(false);
    }
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
        onClose={() => !loading && setOpened(false)}
        title={t("upload.url.title")}
        centered
      >
        <form onSubmit={submit}>
          <Stack spacing="sm">
            <TextInput
              data-autofocus
              value={value}
              disabled={loading}
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder={t("upload.url.placeholder")}
              aria-label={t("upload.url.title")}
            />
            <Text size="xs" color="dimmed">
              <FormattedMessage id="upload.url.hint" />
            </Text>
            <Button type="submit" loading={loading}>
              <FormattedMessage id="upload.url.add" />
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
};

export default UploadFromUrlButton;
