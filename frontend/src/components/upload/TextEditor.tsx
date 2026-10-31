import { ReactNode, useState } from "react";
import { Button, Group, Box, useMantineTheme } from "@mantine/core";
import { useMediaQuery, useViewportSize } from "@mantine/hooks";
import dynamic from "next/dynamic";
import { FormattedMessage } from "react-intl";

const MDEditor = dynamic(
  () => import("@uiw/react-md-editor").then((mod) => mod.default),
  { ssr: false },
);

type TextEditorProps = {
  initialText: string;
  onSave: (newText: string) => void;
  onCancel: () => void;
  // Modals that create a file instead of editing one supply their own action
  // row ("Add to upload"). The render variant receives the current text so the
  // parent does not have to mirror the editor state.
  actions?: ReactNode;
  renderActions?: (text: string) => ReactNode;
  // Plain-text uploads hide the Markdown preview pane, which would otherwise
  // show formatting the share page never renders.
  preview?: "live" | "edit" | "preview";
  // Reports the body so a parent can remount the editor with another pane mode
  // without losing what the user typed.
  onChange?: (text: string) => void;
};

const TextEditor = ({
  initialText,
  onSave,
  onCancel,
  actions,
  renderActions,
  preview = "live",
  onChange,
}: TextEditorProps) => {
  const [text, setText] = useState<string | undefined>(initialText);
  const { colorScheme } = useMantineTheme();
  // The editor lives in a modal; a 400px canvas plus the toolbar and the action
  // row would not fit a phone viewport.
  const isCompact = useMediaQuery("(max-width: 48em)");
  // Short windows (laptops, landscape phones) would otherwise push the action
  // row past the bottom of the dialog. Keep ~360px for the modal chrome.
  const { height: viewportHeight } = useViewportSize();
  const preferredHeight = isCompact ? 260 : 400;
  const editorHeight = viewportHeight
    ? Math.max(180, Math.min(preferredHeight, viewportHeight - 360))
    : preferredHeight;
  // The pane mode is read once on mount, so a split view on a phone would leave
  // ~130px per pane. Phones start in edit mode and can switch to the preview
  // pane from the toolbar.
  const editorPreview = preview === "live" && isCompact ? "edit" : preview;

  const actionRow = renderActions
    ? renderActions(text ?? "")
    : (actions ?? (
        <Group position="right" mt="md">
          <Button variant="default" onClick={onCancel}>
            <FormattedMessage id="common.button.cancel" />
          </Button>
          <Button onClick={() => onSave(text || "")}>
            <FormattedMessage id="common.button.save" />
          </Button>
        </Group>
      ));

  return (
    <Box>
      <Box
        data-color-mode={colorScheme}
        // Custom styles to make the toolbar usable on mobile
        sx={(theme) => ({
          ".w-md-editor-toolbar": {
            flexWrap: "wrap",
            height: "auto",
            minHeight: "auto",
            padding: "8px",
          },
          ".w-md-editor-toolbar li > button": {
            [theme.fn.smallerThan("sm")]: {
              padding: "8px",
              minWidth: "36px",
              minHeight: "36px",
            },
          },
          ".w-md-editor-toolbar li > button svg": {
            [theme.fn.smallerThan("sm")]: {
              width: "18px",
              height: "18px",
            },
          },
        })}
      >
        <MDEditor
          value={text}
          onChange={(next) => {
            setText(next);
            onChange?.(next ?? "");
          }}
          height={editorHeight}
          preview={editorPreview}
        />
      </Box>
      {actionRow}
    </Box>
  );
};

export default TextEditor;
