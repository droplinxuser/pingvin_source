import { Box, Button, Group, Paper, Skeleton } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";
import shareService from "../../services/share.service";
import { FileMetaData } from "../../types/File.type";
import TextContent from "./TextContent";

// Markdown is parsed synchronously, so a huge paste would freeze the tab.
const MAX_PREVIEW_BYTES = 1024 * 1024;
// The preview must not push the file list out of view; longer text starts
// collapsed and can be expanded on request.
const COLLAPSED_HEIGHT = 360;

/**
 * Inline preview of a text or Markdown share. Keeps a "gist" share readable
 * without opening the preview modal, while the file list below it stays the
 * primary way to download.
 */
const ShareTextPreview = ({
  shareId,
  file,
}: {
  shareId: string;
  file: FileMetaData;
}) => {
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const tooLarge = (parseInt(file.size, 10) || 0) > MAX_PREVIEW_BYTES;

  useEffect(() => {
    if (tooLarge) return;
    const controller = new AbortController();
    setFailed(false);
    setText(undefined);
    shareService
      .getFileText(shareId, file.id, controller.signal)
      .then((body) => setText(typeof body === "string" ? body : ""))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [shareId, file.id, tooLarge]);

  // Measure while collapsed only; an expanded block is taller by definition.
  useEffect(() => {
    const element = contentRef.current;
    if (!element || expanded) return;
    const measure = () =>
      setIsClamped(element.scrollHeight > COLLAPSED_HEIGHT + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  // A failed or oversized read stays silent: the file list still offers the
  // preview modal and the download.
  if (tooLarge || failed) return null;
  if (text === undefined)
    return (
      <Paper withBorder radius="md" p="md" mb="lg">
        <Skeleton height={96} radius="sm" />
      </Paper>
    );
  if (!text.trim()) return null;

  const canExpand = isClamped || expanded;

  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      mb="lg"
      component="section"
      aria-label={file.name}
      data-testid="share-text-preview"
    >
      <Box
        ref={contentRef}
        sx={{
          maxHeight: expanded ? undefined : COLLAPSED_HEIGHT,
          overflow: "hidden",
        }}
      >
        <TextContent text={text} fileName={file.name} />
      </Box>
      {canExpand && (
        <Group position="center" mt="sm">
          <Button
            variant="subtle"
            size="xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <FormattedMessage
              id={
                expanded
                  ? "share.custom.text-preview.collapse"
                  : "share.custom.text-preview.expand"
              }
            />
          </Button>
        </Group>
      )}
    </Paper>
  );
};

export default ShareTextPreview;
