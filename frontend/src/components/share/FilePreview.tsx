import {
  ActionIcon,
  Box,
  Center,
  Group,
  Stack,
  Text,
  Title,
  useMantineTheme,
} from "@mantine/core";
import Markdown, { MarkdownToJSX } from "markdown-to-jsx";
import React, { Dispatch, SetStateAction, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbDownload, TbExternalLink } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import api from "../../services/api.service";
import { getShareFileUrl } from "../../utils/file.util";
import { HoverTip } from "../core/HoverTip";
import LazyImage from "../core/LazyImage";
import LazyVideo from "../core/LazyVideo";

// The modal itself is capped at 90dvh. Leave room for its header, body padding
// and the action row so images and videos never make the dialog scroll.
const MEDIA_MAX_HEIGHT = "calc(90dvh - 160px)";

const FilePreviewContext = React.createContext<{
  shareId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  setIsNotSupported: Dispatch<SetStateAction<boolean>>;
}>({
  shareId: "",
  fileId: "",
  fileName: "",
  mimeType: "",
  setIsNotSupported: () => {},
});

const FilePreview = ({
  shareId,
  fileId,
  fileName,
  mimeType,
}: {
  shareId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
}) => {
  const t = useTranslate();
  const [isNotSupported, setIsNotSupported] = useState(false);

  const actions = (
    <Group position="right" spacing="xs">
      <HoverTip label={t("share.modal.file-preview.original_file")}>
        <ActionIcon
          component="a"
          href={getShareFileUrl(shareId, fileId, { download: false })}
          target="_blank"
          rel="noopener"
          variant="light"
          color="gray"
          size="lg"
          aria-label={t("share.modal.file-preview.original_file")}
        >
          <TbExternalLink size={18} />
        </ActionIcon>
      </HoverTip>
      <HoverTip label={t("common.button.download")}>
        <ActionIcon
          component="a"
          href={getShareFileUrl(shareId, fileId, { download: true })}
          variant="light"
          color="cyan"
          size="lg"
          aria-label={t("common.button.download")}
        >
          <TbDownload size={18} />
        </ActionIcon>
      </HoverTip>
    </Group>
  );

  if (isNotSupported)
    return (
      <Stack>
        <UnSupportedFile />
        {actions}
      </Stack>
    );

  return (
    <Stack>
      <FilePreviewContext.Provider
        value={{ shareId, fileId, fileName, mimeType, setIsNotSupported }}
      >
        <FileDecider />
      </FilePreviewContext.Provider>
      {actions}
    </Stack>
  );
};

const FileDecider = () => {
  const { mimeType } = React.useContext(FilePreviewContext);

  if (mimeType == "application/pdf") {
    return <PdfPreview />;
  } else if (mimeType.startsWith("video/")) {
    return <VideoPreview />;
  } else if (mimeType.startsWith("image/")) {
    return <ImagePreview />;
  } else if (mimeType.startsWith("audio/")) {
    return <AudioPreview />;
  } else if (mimeType.startsWith("text/")) {
    return <TextPreview />;
  } else {
    // Render the fallback directly instead of setting parent state during
    // render, which React reports as a cross-component update warning.
    return <UnSupportedFile />;
  }
};

const AudioPreview = () => {
  const { shareId, fileId, setIsNotSupported } =
    React.useContext(FilePreviewContext);
  return (
    <Center style={{ minHeight: 200 }}>
      <Stack align="center" spacing={10} style={{ width: "100%" }}>
        <audio controls style={{ width: "100%" }}>
          <source
            src={getShareFileUrl(shareId, fileId, { download: false })}
            onError={() => setIsNotSupported(true)}
          />
        </audio>
      </Stack>
    </Center>
  );
};

const VideoPreview = () => {
  const { shareId, fileId, setIsNotSupported } =
    React.useContext(FilePreviewContext);
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        maxWidth: "100%",
      }}
    >
      <LazyVideo
        src={getShareFileUrl(shareId, fileId, { download: false })}
        controls
        playsInline
        style={{
          maxWidth: "100%",
          maxHeight: MEDIA_MAX_HEIGHT,
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
        onError={() => setIsNotSupported(true)}
      />
    </Box>
  );
};

const ImagePreview = () => {
  const { shareId, fileId, fileName, setIsNotSupported } =
    React.useContext(FilePreviewContext);
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        maxWidth: "100%",
      }}
    >
      <LazyImage
        // The full-size modal uses the original image; 300px WebP thumbnails
        // are only for the gallery and trending grids.
        src={getShareFileUrl(shareId, fileId, { download: false })}
        alt={`Preview of ${fileName || fileId}`}
        style={{
          maxWidth: "100%",
          maxHeight: MEDIA_MAX_HEIGHT,
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
        onError={() => setIsNotSupported(true)}
      />
    </Box>
  );
};

const TextPreview = () => {
  const { shareId, fileId } = React.useContext(FilePreviewContext);
  const [text, setText] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const { colorScheme } = useMantineTheme();
  const t = useTranslate();

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    api
      .get(`/shares/${shareId}/files/${fileId}?download=false`, {
        signal: controller.signal,
      })
      .then((res) => setText(res.data ?? ""))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [shareId, fileId]);

  if (failed) return <Text color="dimmed">{t("common.error")}</Text>;

  const options: MarkdownToJSX.Options = {
    disableParsingRawHTML: true,
    overrides: {
      pre: {
        props: {
          style: {
            backgroundColor:
              colorScheme == "dark"
                ? "rgba(50, 50, 50, 0.5)"
                : "rgba(220, 220, 220, 0.5)",
            padding: "0.75em",
            whiteSpace: "pre-wrap",
          },
        },
      },
      table: {
        props: {
          className: "md",
        },
      },
    },
  };

  return (
    <Box
      sx={{
        maxHeight: MEDIA_MAX_HEIGHT,
        overflowY: "auto",
        overflowWrap: "anywhere",
      }}
    >
      <Markdown options={options}>{text}</Markdown>
    </Box>
  );
};

const PdfPreview = () => {
  const { shareId, fileId, fileName } = React.useContext(FilePreviewContext);
  const src = getShareFileUrl(shareId, fileId, { download: false });

  return (
    <Box
      sx={{
        width: "100%",
        height: MEDIA_MAX_HEIGHT,
        overflow: "hidden",
        borderRadius: 4,
        backgroundColor: "rgba(0, 0, 0, 0.04)",
      }}
    >
      <iframe
        src={`${src}#view=FitH`}
        title={fileName || fileId}
        style={{ display: "block", width: "100%", height: "100%", border: 0 }}
      />
    </Box>
  );
};

const UnSupportedFile = () => {
  return (
    <Center style={{ minHeight: 200 }}>
      <Stack align="center" spacing={10}>
        <Title order={3}>
          <FormattedMessage id="share.modal.file-preview.error.not-supported.title" />
        </Title>
        <Text>
          <FormattedMessage id="share.modal.file-preview.error.not-supported.description" />
        </Text>
      </Stack>
    </Center>
  );
};

export default FilePreview;
