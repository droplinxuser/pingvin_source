import {
  Button,
  Center,
  Group,
  Space,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { hideNotification } from "@mantine/notifications";
import { AxiosError } from "axios";
import pLimit from "p-limit";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { TbShieldLock } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import Dropzone from "../../components/upload/Dropzone";
import FileList from "../../components/upload/FileList";

import useConfig from "../../hooks/config.hook";
import useConfirmLeave from "../../hooks/confirm-leave.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import useUser from "../../hooks/user.hook";
import shareService from "../../services/share.service";
import { FileUpload } from "../../types/File.type";
import { CreateShare, Share } from "../../types/share.type";
import toast from "../../utils/toast.util";
import { useRouter } from "next/router";
import {
  getNormalizedFileName,
  validateAndFilterFiles,
} from "../../utils/file.util";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

const promiseLimit = pLimit(3);
const MAX_UPLOAD_RETRIES = 3;
let errorToastShown = false;
let createdShare: Share;

const Upload = ({
  maxShareSize,
  isReverseShare = false,
  simplified,
}: {
  maxShareSize?: number;
  isReverseShare: boolean;
  simplified: boolean;
}) => {
  const modals = useModals();
  const router = useRouter();
  const t = useTranslate();

  const { user } = useUser();
  const config = useConfig();
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [isUploading, setisUploading] = useState(false);

  const filesRef = useRef<FileUpload[]>(files);
  filesRef.current = files;
  // One controller per in-flight file so the list can cancel an upload.
  const uploadAbortsRef = useRef(new Map<FileUpload, AbortController>());

  useConfirmLeave({
    message: t("upload.notify.confirm-leave"),
    enabled: isUploading,
  });

  const chunkSize = useRef(parseInt(config.get("share.chunkSize")));
  const maxFileSize = parseInt(config.get("share.maxFileSize") || "0");

  maxShareSize ??= user?.shareSizeLimit
    ? parseInt(user.shareSizeLimit)
    : parseInt(config.get("share.maxSize"));

  const currentFilesSize = useMemo(() => {
    return files.reduce((acc, file) => acc + file.size, 0);
  }, [files]);

  const autoOpenCreateUploadModal = config.get("share.autoOpenShareModal");

  const uploadFiles = async (share: CreateShare, files: FileUpload[]) => {
    setisUploading(true);

    try {
      const isReverseShare = router.pathname != "/upload";
      const totalSize = files.reduce((acc, file) => acc + file.size, 0);
      createdShare = await shareService.create(
        { ...share, size: totalSize },
        isReverseShare,
      );
    } catch (e) {
      toast.axiosError(e);
      setisUploading(false);
      return;
    }

    const fileUploadPromises = files.map(async (file) =>
      // Limit the number of concurrent uploads to 3
      promiseLimit(async () => {
        let fileId;
        const controller = new AbortController();
        const { signal } = controller;
        uploadAbortsRef.current.set(file, controller);

        // Match the progress target by object reference so removing or
        // cancelling a file mid-upload cannot shift progress onto another row.
        const setFileProgress = (progress: number) => {
          setFiles((current) =>
            current.map((candidate) => {
              if (candidate === file) candidate.uploadingProgress = progress;
              return candidate;
            }),
          );
        };

        setFileProgress(1);

        // URL entries are fetched by the backend after the share exists, so the
        // browser never contacts the remote host (and CORS does not apply).
        if (file.remoteUrl) {
          try {
            await shareService.uploadFromUrl(
              createdShare.id,
              file.remoteUrl,
              getNormalizedFileName(file),
              signal,
            );
            setFileProgress(100);
          } catch (e) {
            if (signal.aborted) return;
            toast.axiosError(e);
            setFileProgress(-1);
          }
          return;
        }

        let chunks = Math.ceil(file.size / chunkSize.current);

        // If the file is 0 bytes, we still need to upload 1 chunk
        if (chunks == 0) chunks++;

        let retries = 0;
        for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
          if (signal.aborted) return;
          const from = chunkIndex * chunkSize.current;
          const to = from + chunkSize.current;
          const blob = file.slice(from, to);
          try {
            await shareService
              .uploadFile(
                createdShare.id,
                blob,
                {
                  id: fileId,
                  name: getNormalizedFileName(file),
                },
                chunkIndex,
                chunks,
                (progressEvent) => {
                  if (progressEvent.total && file.size > 0) {
                    const chunkProgress =
                      progressEvent.loaded / progressEvent.total;
                    const uploadedBytesBeforeThisChunk =
                      chunkIndex * chunkSize.current;
                    const uploadedBytesInThisChunk = blob.size * chunkProgress;
                    const totalUploaded =
                      uploadedBytesBeforeThisChunk + uploadedBytesInThisChunk;
                    const overallPercent = (totalUploaded / file.size) * 100;
                    setFileProgress(Math.min(overallPercent, 99.9));
                  }
                },
                signal,
              )
              .then((response) => {
                fileId = response.id;
              });

            retries = 0;
            setFileProgress(((chunkIndex + 1) / chunks) * 100);
          } catch (e) {
            // A cancelled upload stops; a rejected chunk is retried within a
            // small budget and then marked failed instead.
            if (signal.aborted) return;
            if (++retries > MAX_UPLOAD_RETRIES) {
              setFileProgress(-1);
              break;
            }
            if (
              e instanceof AxiosError &&
              e.response?.data.error == "unexpected_chunk_index"
            ) {
              // Retry with the expected chunk index
              chunkIndex = e.response!.data!.expectedChunkIndex - 1;
              continue;
            } else {
              setFileProgress(-1);
              // Retry after 5 seconds
              await new Promise((resolve) => setTimeout(resolve, 5000));
              chunkIndex = -1;

              continue;
            }
          }
        }
      }),
    );

    Promise.all(fileUploadPromises);
  };

  const cancelUpload = useCallback((file: FileUpload) => {
    uploadAbortsRef.current.get(file)?.abort();
    uploadAbortsRef.current.delete(file);
    setFiles((current) => {
      const next = current.filter((candidate) => candidate !== file);
      filesRef.current = next;
      return next;
    });
  }, []);

  const showCreateUploadModalCallback = async (files: FileUpload[]) => {
    // Both modals pull in yup, moment and the QR renderer. Load them only when
    // the modal is actually opened so the first /upload paint stays light.
    const { default: showCreateUploadModal } =
      await import("../../components/upload/modals/showCreateUploadModal");
    showCreateUploadModal(
      modals,
      {
        isUserSignedIn: user ? true : false,
        appUrl: config.get("general.appUrl"),
        defaultAppUrl: config.get("general.appUrl", true),
        allowUnauthenticatedShares: config.get(
          "security.allowUnauthenticatedShares",
        ),
        enableEmailRecepients: config.get("share.enableShareEmailRecipients"),
        enableUserRecipients: config.get("share.enableUserRecipients"),
        shareIdLength: config.get("share.shareIdLength"),
        simplified,
      },
      files,
      uploadFiles,
    );
  };

  const handleDropzoneFilesChanged = useCallback(
    (newFiles: FileUpload[]) => {
      const baseFiles = autoOpenCreateUploadModal ? [] : filesRef.current;

      const filtered = validateAndFilterFiles(
        newFiles,
        baseFiles,
        maxShareSize!,
        (normalizedName) =>
          toast.error(
            t("upload.notify.duplicate-skipped", { name: normalizedName }),
          ),
        () =>
          toast.error(
            t("upload.dropzone.notify.file-too-big", {
              maxSize: byteToHumanSizeString(maxShareSize!),
            }),
          ),
      );
      if (filtered.length === 0) return;

      if (autoOpenCreateUploadModal) {
        filesRef.current = filtered;
        setFiles(filtered);
        showCreateUploadModalCallback(filtered);
      } else {
        const nextFiles = [...filesRef.current, ...filtered];
        filesRef.current = nextFiles;
        setFiles(nextFiles);
      }
    },
    [maxShareSize, autoOpenCreateUploadModal, t, showCreateUploadModalCallback],
  );

  useEffect(() => {
    // Check if there are any files that failed to upload
    const fileErrorCount = files.filter(
      (file) => file.uploadingProgress == -1,
    ).length;

    if (fileErrorCount > 0) {
      if (!errorToastShown) {
        toast.error(
          t("upload.notify.count-failed", { count: fileErrorCount }),
          {
            id: "upload-failed",
            withCloseButton: false,
            autoClose: false,
          },
        );
      }
      errorToastShown = true;
    } else {
      if (errorToastShown) {
        hideNotification("upload-failed");
      }
      errorToastShown = false;
    }

    // Complete share
    if (
      files.length > 0 &&
      files.every((file) => file.uploadingProgress >= 100) &&
      fileErrorCount == 0
    ) {
      shareService
        .completeShare(createdShare.id)
        .then(async (share) => {
          setisUploading(false);
          const { default: showCompletedUploadModal } =
            await import("../../components/upload/modals/showCompletedUploadModal");
          showCompletedUploadModal(
            modals,
            share,
            config.get("general.appUrl"),
            config.get("general.appUrl", true),
          );
          setFiles([]);
        })
        .catch(() => toast.error(t("upload.notify.generic-error")));
    }
  }, [files]);

  // Clear the "uploading" state once nothing is queued or in flight (for
  // example after every file was cancelled or failed). The block above only
  // covers the success path.
  useEffect(() => {
    if (!isUploading) return;
    const busy = files.some(
      (file) => file.uploadingProgress >= 0 && file.uploadingProgress < 100,
    );
    if (!busy) setisUploading(false);
  }, [files, isUploading]);

  if (user && user.allowShare === false && !isReverseShare) {
    return (
      <>
        <Meta title={t("upload.title")} />
        <Center style={{ height: "70vh" }}>
          <Stack align="center" spacing={10}>
            <TbShieldLock size={48} color="gray" />
            <Title order={1} size="h3">
              <FormattedMessage id="upload.error.not-allowed.title" />
            </Title>
            <Text color="dimmed" align="center">
              <FormattedMessage id="upload.error.not-allowed.description" />
            </Text>
            <Space h={5} />
            <Button component={Link} href="/account/shares" variant="light">
              <FormattedMessage id="account.shares.title" />
            </Button>
          </Stack>
        </Center>
      </>
    );
  }

  return (
    <>
      <Meta title={t("upload.title")} />
      <Title order={1} className="visually-hidden">
        {t("upload.title")}
      </Title>
      <Group position="right" mb={20}>
        <Button
          loading={isUploading}
          disabled={files.length <= 0}
          onClick={() => showCreateUploadModalCallback(files)}
        >
          <FormattedMessage id="common.button.share" />
        </Button>
      </Group>
      <Dropzone
        title={
          !autoOpenCreateUploadModal && files.length > 0
            ? t("share.edit.append-upload")
            : undefined
        }
        maxShareSize={maxShareSize}
        maxFileSize={maxFileSize}
        currentFilesSize={currentFilesSize}
        onFilesChanged={handleDropzoneFilesChanged}
        isUploading={isUploading}
      />
      {files.length > 0 && (
        <FileList<FileUpload>
          files={files}
          setFiles={setFiles}
          onCancel={cancelUpload}
        />
      )}
    </>
  );
};
export default Upload;
