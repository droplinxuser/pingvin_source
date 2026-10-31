import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";
import { TbFileText } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import { HoverTip } from "../core/HoverTip";
import useTranslate from "../../hooks/useTranslate.hook";
import { FileUpload } from "../../types/File.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import toast from "../../utils/toast.util";
import TextEditor from "./TextEditor";

type TextKind = "markdown" | "plain";

// The extension decides how the share page renders the upload: Markdown is
// parsed, everything else is shown verbatim. HTML is never parsed.
const TEXT_KINDS: Record<TextKind, { name: string; mimeType: string }> = {
  markdown: { name: "note.md", mimeType: "text/markdown" },
  plain: { name: "note.txt", mimeType: "text/plain" },
};

// Same width as the page container, so the editor lines up with the rest of
// the site instead of sitting in a narrower dialog.
const MODAL_WIDTH = 960;
const FIELD_ID = "share-text-input";

/**
 * Adds a text "gist" to the upload queue. The text becomes a regular file, so
 * it travels through the normal share, password, quota and download flows.
 */
const UploadTextButton = ({
  onFiles,
  disabled,
  maxFileSize = 0,
}: {
  onFiles: (files: FileUpload[]) => void;
  disabled?: boolean;
  maxFileSize?: number;
}) => {
  const t = useTranslate();
  const [opened, setOpened] = useState(false);
  const [kind, setKind] = useState<TextKind>("markdown");
  // The editor is remounted when the format changes (its pane mode is read only
  // on mount), so the body is kept here to survive the switch.
  const [draft, setDraft] = useState("");

  const close = () => {
    setOpened(false);
    setKind("markdown");
    setDraft("");
  };

  const add = (text: string) => {
    if (!text.trim()) {
      toast.error(t("upload.text.error.empty"));
      return;
    }

    const size = new Blob([text]).size;
    if (maxFileSize > 0 && size > maxFileSize) {
      toast.error(
        t("upload.text.error.too-large", {
          maxSize: byteToHumanSizeString(maxFileSize),
        }),
      );
      return;
    }

    const { name, mimeType } = TEXT_KINDS[kind];
    const file = new File([text], name, { type: mimeType }) as FileUpload;
    file.uploadingProgress = 0;
    onFiles([file]);
    toast.success(t("upload.text.notify.added", { name }));
    close();
  };

  return (
    <>
      <HoverTip label={t("upload.text.hint.button")} position="top">
        <Button
          variant="light"
          size="sm"
          radius="xl"
          leftIcon={<TbFileText size={16} />}
          disabled={disabled}
          onClick={() => setOpened(true)}
        >
          <FormattedMessage id="upload.text.button" />
        </Button>
      </HoverTip>

      <Modal
        opened={opened}
        onClose={close}
        title={t("upload.text.title")}
        size={MODAL_WIDTH}
        centered
      >
        {/* The editor renders its own <form>, so this dialog has a real form
            with a named textarea for browser extensions and grammar tools. */}
        <Stack spacing="sm">
          <SegmentedControl
            fullWidth
            value={kind}
            onChange={(value) => setKind(value as TextKind)}
            data={[
              { label: t("upload.text.markdown"), value: "markdown" },
              { label: t("upload.text.plain"), value: "plain" },
            ]}
          />
          <Text size="xs" color="dimmed">
            <FormattedMessage
              id={
                kind === "markdown"
                  ? "upload.text.hint"
                  : "upload.text.hint.plain"
              }
            />
          </Text>
          <TextEditor
            key={kind}
            initialText={draft}
            onSave={add}
            onCancel={close}
            onChange={setDraft}
            preview={kind === "markdown" ? "live" : "edit"}
            hideToolbar={kind === "plain"}
            fieldId={FIELD_ID}
            fieldLabel={t("upload.text.field")}
            placeholder={t("upload.text.placeholder")}
            renderActions={(text) => (
              <Group position="right" mt="md">
                <Button type="button" variant="default" onClick={close}>
                  <FormattedMessage id="common.button.cancel" />
                </Button>
                <Button type="submit" disabled={!text.trim()}>
                  <FormattedMessage id="upload.text.add" />
                </Button>
              </Group>
            )}
          />
        </Stack>
      </Modal>
    </>
  );
};

export default UploadTextButton;
