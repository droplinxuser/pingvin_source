import {
  Button,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { FormEvent, useState } from "react";
import { TbLink } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import { FileUpload } from "../../types/File.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import toast from "../../utils/toast.util";

/**
 * Adds a file by URL. The fetch runs in the visitor's own browser, so the main
 * server never resolves or downloads the remote URL (no SSRF, no server IP
 * exposure). CORS may block some hosts; those report a friendly error.
 */
const resolveFileName = (
  url: URL,
  blob: Blob,
  contentDisposition?: string | null,
): string => {
  const fromHeader = contentDisposition?.match(
    /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i,
  )?.[1];
  if (fromHeader) {
    try {
      return decodeURIComponent(fromHeader);
    } catch {
      return fromHeader;
    }
  }

  const segment = url.pathname.split("/").filter(Boolean).pop();
  if (segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }

  const extension = blob.type.split("/")[1];
  return `download${extension ? `.${extension}` : ""}`;
};

const UploadFromUrlButton = ({
  onFiles,
  maxFileSize,
  disabled,
}: {
  onFiles: (files: FileUpload[]) => void;
  maxFileSize: number;
  disabled?: boolean;
}) => {
  const t = useTranslate();
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState("");
  const [isFetching, setIsFetching] = useState(false);

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

    setIsFetching(true);
    try {
      const response = await fetch(url.toString(), {
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const max = maxFileSize > 0 ? maxFileSize : Number.POSITIVE_INFINITY;
      const tooBig = () =>
        toast.error(
          t("upload.url.error.too-big", {
            maxSize: byteToHumanSizeString(maxFileSize),
          }),
        );

      const lengthHeader = response.headers.get("content-length");
      if (lengthHeader && Number(lengthHeader) > max) {
        tooBig();
        return;
      }

      // Stream the body and abort once the cap is passed so a huge remote file
      // cannot exhaust the browser's memory.
      let blob: Blob;
      if (response.body && Number.isFinite(max)) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          received += value.length;
          if (received > max) {
            await reader.cancel().catch(() => {});
            tooBig();
            return;
          }
          chunks.push(value);
        }
        blob = new Blob(chunks as never, {
          type:
            response.headers.get("content-type") ?? "application/octet-stream",
        });
      } else {
        blob = await response.blob();
        if (blob.size > max) {
          tooBig();
          return;
        }
      }

      const name = resolveFileName(
        url,
        blob,
        response.headers.get("content-disposition"),
      );
      const file = new File([blob], name, {
        type: blob.type || "application/octet-stream",
      }) as FileUpload;
      file.uploadingProgress = 0;

      onFiles([file]);
      toast.success(t("upload.url.notify.added", { name }));
      setValue("");
      setOpened(false);
    } catch {
      toast.error(t("upload.url.error.fetch"));
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <>
      <Button
        variant="light"
        size="sm"
        radius="xl"
        ml="sm"
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
            <Button type="submit" loading={isFetching}>
              <FormattedMessage id="upload.url.fetch" />
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
};

export default UploadFromUrlButton;
