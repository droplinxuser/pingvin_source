import { Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { AxiosError } from "axios";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbPlayerPlay, TbTrash } from "react-icons/tb";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import toast from "../../utils/toast.util";
import {
  listUploadSessions,
  matchesUploadSession,
  removeUploadSession,
  updateUploadProgress,
  UploadSession,
} from "../../utils/uploadSession.util";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

/**
 * Offers the unfinished uploads left in IndexedDB after a reload. The browser
 * cannot persist the visitor's File object, so the same file must be selected
 * again; the manifest then skips the chunks already accepted by the server.
 */
const ResumeUploads = () => {
  const t = useTranslate();
  const config = useConfig();
  const modals = useModals();
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [target, setTarget] = useState<UploadSession>();
  const [busyKey, setBusyKey] = useState<string>();
  const [progress, setProgress] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const chunkSize = parseInt(config.get("share.chunkSize") || "0");

  const refresh = async () => setSessions(await listUploadSessions());

  useEffect(() => {
    void listUploadSessions().then(setSessions);
  }, []);

  const resume = (session: UploadSession) => {
    setTarget(session);
    inputRef.current?.click();
  };

  const discard = async (session: UploadSession) => {
    await removeUploadSession(session.shareId, session.fileId);
    setSessions((current) =>
      current.filter((item) => item.key !== session.key),
    );
    toast.success(t("upload.resume.discarded"));
  };

  const uploadMissingChunks = async (session: UploadSession, file: File) => {
    setBusyKey(session.key);
    setProgress((current) => ({
      ...current,
      [session.key]: (session.completedChunks / session.totalChunks) * 100,
    }));

    try {
      let chunkIndex = session.completedChunks;
      let retries = 0;
      while (chunkIndex < session.totalChunks) {
        const from = chunkIndex * session.chunkSize;
        const blob = file.slice(from, from + session.chunkSize);
        try {
          await shareService.uploadFile(
            session.shareId,
            blob,
            { id: session.fileId, name: session.name },
            chunkIndex,
            session.totalChunks,
          );
          chunkIndex++;
          retries = 0;
          await updateUploadProgress(
            session.shareId,
            session.fileId,
            chunkIndex,
          );
          setProgress((current) => ({
            ...current,
            [session.key]: (chunkIndex / session.totalChunks) * 100,
          }));
        } catch (error) {
          if (
            error instanceof AxiosError &&
            error.response?.data?.error === "unexpected_chunk_index"
          ) {
            chunkIndex = Math.max(
              0,
              Number(error.response.data.expectedChunkIndex) - 1,
            );
            continue;
          }
          if (++retries > 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      let remaining = await listUploadSessions();
      const sameShare = remaining.filter(
        (item) => item.shareId === session.shareId,
      );
      const incomplete = sameShare.filter(
        (item) => item.completedChunks < item.totalChunks,
      );

      if (incomplete.length === 0) {
        const share = await shareService.completeShare(session.shareId);
        await Promise.all(
          sameShare.map((item) =>
            removeUploadSession(item.shareId, item.fileId),
          ),
        );
        remaining = remaining.filter(
          (item) => item.shareId !== session.shareId,
        );
        setSessions(remaining);
        const { default: showCompletedUploadModal } =
          await import("./modals/showCompletedUploadModal");
        showCompletedUploadModal(
          modals,
          share,
          config.get("general.appUrl"),
          config.get("general.appUrl", true),
        );
      } else {
        await removeUploadSession(session.shareId, session.fileId);
        setSessions(remaining.filter((item) => item.key !== session.key));
        toast.success(t("upload.resume.completed"));
      }
    } catch (error) {
      toast.axiosError(error);
      await refresh();
    } finally {
      setBusyKey(undefined);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!target || !file) return;

    if (chunkSize > 0 && chunkSize !== target.chunkSize) {
      toast.error(t("upload.resume.chunk-size-changed"));
      return;
    }
    if (!matchesUploadSession(target, file)) {
      toast.error(
        t("upload.resume.mismatch", {
          name: target.name,
          size: byteToHumanSizeString(target.size),
        }),
      );
      return;
    }

    await uploadMissingChunks(target, file);
    setTarget(undefined);
  };

  if (sessions.length === 0) return null;

  return (
    <Paper withBorder radius="md" p="sm" mb="md" data-testid="resume-uploads">
      <Stack spacing="xs">
        <Text weight={700}>{t("upload.resume.title")}</Text>
        <Text size="xs" color="dimmed">
          {t("upload.resume.description")}
        </Text>
        <input
          ref={inputRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleFile}
        />
        {sessions.map((session) => {
          const remaining = Math.max(
            session.totalChunks - session.completedChunks,
            0,
          );
          const percent =
            progress[session.key] ??
            (session.completedChunks / session.totalChunks) * 100;
          return (
            <Paper key={session.key} withBorder radius="sm" p="xs">
              <Group position="apart" align="center" noWrap>
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <Text size="sm" weight={600} truncate>
                    {session.name}
                  </Text>
                  <Text size="xs" color="dimmed">
                    {byteToHumanSizeString(session.size)} ·{" "}
                    <FormattedMessage
                      id="upload.resume.remaining"
                      values={{ count: remaining, total: session.totalChunks }}
                    />
                  </Text>
                  {busyKey === session.key && (
                    <Progress value={percent} size="xs" mt={4} />
                  )}
                </Stack>
                <Group spacing="xs" noWrap>
                  <Button
                    size="xs"
                    variant="light"
                    leftIcon={<TbPlayerPlay size={14} />}
                    loading={busyKey === session.key}
                    disabled={!!busyKey}
                    onClick={() => resume(session)}
                  >
                    {t("upload.resume.button")}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red.9"
                    leftIcon={<TbTrash size={14} />}
                    disabled={!!busyKey}
                    onClick={() => void discard(session)}
                  >
                    {t("upload.resume.discard")}
                  </Button>
                </Group>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
};

export default ResumeUploads;
