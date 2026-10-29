import {
  Button,
  Center,
  createStyles,
  Group,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { Dropzone as MantineDropzone } from "@mantine/dropzone";
import React, { ForwardedRef, useEffect, useRef, useState } from "react";
import { TbCloudUpload, TbFolder } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useClipboardPaste from "../../hooks/useClipboardPaste.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import { FileUpload } from "../../types/File.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import { getFilesFromEvent } from "../../utils/file.util";
import toast from "../../utils/toast.util";
import UploadFromUrlButton from "./UploadFromUrlButton";

const useStyles = createStyles((theme) => ({
  wrapper: {
    position: "relative",
    marginBottom: 30,
  },

  dropzone: {
    borderWidth: 1,
    paddingBottom: 50,
  },

  icon: {
    color:
      theme.colorScheme === "dark"
        ? theme.colors.dark[3]
        : theme.colors.gray[4],
  },

  control: {
    position: "absolute",
    bottom: -20,
  },

  mobileDescription: {
    display: "none",
    "@media (pointer: coarse)": {
      display: "inline",
    },
  },

  desktopDescription: {
    display: "inline",
    "@media (pointer: coarse)": {
      display: "none",
    },
  },
}));

const Dropzone = ({
  title,
  isUploading,
  maxShareSize,
  maxFileSize,
  currentFilesSize = 0,
  onFilesChanged,
}: {
  title?: string;
  isUploading: boolean;
  maxShareSize: number;
  maxFileSize: number;
  currentFilesSize?: number;
  onFilesChanged: (files: FileUpload[]) => void;
}) => {
  const t = useTranslate();
  const { classes } = useStyles();
  const openRef = useRef<() => void>();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [isFirefox, setIsFirefox] = useState(false);
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    setIsMounted(true);
    setIsMac(/Macintosh|Mac OS X/.test(navigator.userAgent));
    setIsFirefox(/Firefox/.test(navigator.userAgent));
  }, []);

  const isFolderUploadSupported =
    isMounted &&
    typeof HTMLInputElement !== "undefined" &&
    "webkitdirectory" in HTMLInputElement.prototype;

  // The page enforces the total share size; this guard keeps the per-file cap
  // applied to drops, folder picks and pasted files alike.
  const handleFiles = (files: FileUpload[]) => {
    const oversizedFile =
      maxFileSize > 0 ? files.find((file) => file.size > maxFileSize) : null;
    if (oversizedFile) {
      toast.error(
        t("upload.dropzone.custom.file-too-big", {
          name: oversizedFile.name,
          maxSize: byteToHumanSizeString(maxFileSize),
        }),
      );
      return;
    }

    onFilesChanged(
      files.map((file) => {
        file.uploadingProgress = 0;
        return file;
      }),
    );
  };

  useClipboardPaste({
    onFiles: handleFiles,
    disabled: isUploading,
  });

  const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = event.target.files;
    if (!filesList) return;

    handleFiles(Array.from(filesList) as FileUpload[]);
    event.target.value = "";
  };

  const descriptionId = (mobile: boolean) => {
    const suffix = isFolderUploadSupported ? "" : ".no-folder";
    if (mobile) return `upload.dropzone.description.mobile${suffix}`;
    if (isFirefox) {
      return `upload.dropzone.description.desktop.firefox${suffix}`;
    }
    return `upload.dropzone.description.desktop${suffix}`;
  };

  return (
    <div className={classes.wrapper}>
      <input
        type="file"
        ref={folderInputRef}
        style={{ display: "none" }}
        {...({
          webkitdirectory: "",
          directory: "",
        } as any)}
        multiple
        onChange={handleFolderSelect}
      />
      <MantineDropzone
        onReject={(e) => {
          toast.error(e[0].errors[0].message);
        }}
        disabled={isUploading}
        openRef={openRef as ForwardedRef<() => void>}
        getFilesFromEvent={getFilesFromEvent}
        onDrop={handleFiles}
        className={classes.dropzone}
        radius="md"
      >
        <div style={{ pointerEvents: "none" }}>
          <Group position="center">
            <TbCloudUpload size={50} />
          </Group>
          <Text align="center" weight={700} size="lg" mt="xl">
            {title || <FormattedMessage id="upload.dropzone.title" />}
          </Text>
          <Text align="center" size="sm" mt="xs" color="dimmed">
            <span className={classes.mobileDescription}>
              <FormattedMessage
                id={
                  isMounted
                    ? descriptionId(true)
                    : "upload.dropzone.description.mobile"
                }
                values={{
                  maxSize: byteToHumanSizeString(maxShareSize),
                }}
              />
            </span>
            <span className={classes.desktopDescription}>
              <FormattedMessage
                id={
                  isMounted
                    ? descriptionId(false)
                    : "upload.dropzone.description.desktop"
                }
                values={{
                  maxSize: byteToHumanSizeString(maxShareSize),
                  shortcut: isMac ? "⌘+V" : "Ctrl+V",
                }}
              />
            </span>
          </Text>
          {maxFileSize > 0 && (
            <Text align="center" size="xs" mt={4} color="dimmed">
              <FormattedMessage
                id="upload.dropzone.custom.max-file-size"
                values={{ maxFileSize: byteToHumanSizeString(maxFileSize) }}
              />
            </Text>
          )}
        </div>
      </MantineDropzone>
      <Center>
        <Group className={classes.control} spacing="sm" position="center">
          {isFolderUploadSupported && (
            <Button
              variant={dark ? "filled" : "light"}
              size="sm"
              radius="xl"
              disabled={isUploading}
              onClick={() => folderInputRef.current?.click()}
            >
              <TbFolder style={{ marginRight: 6 }} />
              <FormattedMessage
                id={
                  currentFilesSize > 0
                    ? "upload.button.folder.append"
                    : "upload.button.folder"
                }
              />
            </Button>
          )}
          <UploadFromUrlButton
            onFiles={handleFiles}
            maxFileSize={maxFileSize}
            disabled={isUploading}
          />
        </Group>
      </Center>
    </div>
  );
};
export default Dropzone;
