import { LoadingOverlay, Title } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { GetServerSidePropsContext } from "next";
import { useEffect, useState } from "react";
import Meta from "../../../components/Meta";
import showErrorModal from "../../../components/share/showErrorModal";
import EditableUpload from "../../../components/upload/EditableUpload";
import useConfirmLeave from "../../../hooks/confirm-leave.hook";
import useTranslate from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { Share as ShareType } from "../../../types/share.type";
import toast from "../../../utils/toast.util";

export function getServerSideProps(context: GetServerSidePropsContext) {
  return {
    props: { shareId: context.params!.shareId },
  };
}

const Share = ({ shareId }: { shareId: string }) => {
  const t = useTranslate();
  const modals = useModals();

  const [isLoading, setIsLoading] = useState(true);
  const [share, setShare] = useState<ShareType>();
  const [isDirty, setIsDirty] = useState(false);

  // Ask before leaving only when there are unsaved file changes.
  const allowLeave = useConfirmLeave({
    message: t("upload.notify.confirm-leave"),
    enabled: isDirty,
  });

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setShare(undefined);
    setIsDirty(false);

    shareService
      .getFromOwner(shareId)
      .then((share) => {
        if (!cancelled) setShare(share);
      })
      .catch((e) => {
        if (cancelled) return;
        if (!e.response) {
          toast.axiosError(e);
          return;
        }
        if (e.response.status == 429) {
          showErrorModal(
            modals,
            t("common.custom.rate-limit.title"),
            t("common.custom.rate-limit.description"),
            "go-home",
          );
          return;
        }

        const { error } = e.response.data;
        if (e.response.status == 404) {
          if (error == "share_removed") {
            showErrorModal(
              modals,
              t("share.error.removed.title"),
              e.response.data.message,
            );
          } else {
            showErrorModal(
              modals,
              t("share.error.not-found.title"),
              t("share.error.not-found.description"),
            );
          }
        } else if (e.response.status == 403 && error == "share_removed") {
          showErrorModal(
            modals,
            t("share.error.access-denied.title"),
            t("share.error.access-denied.description"),
          );
        } else {
          showErrorModal(modals, t("common.error"), t("common.error.unknown"));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (isLoading) return <LoadingOverlay visible />;

  return (
    <>
      <Meta title={t("share.edit.title", { shareId })} />
      <Title order={1} size="h3" mb="md">
        {t("share.edit.title", { shareId })}
      </Title>
      <EditableUpload
        shareId={shareId}
        files={share?.files || []}
        onDirtyChange={setIsDirty}
        onSaved={allowLeave}
        maxShareSize={
          share?.creator?.shareSizeLimit
            ? parseInt(share.creator.shareSizeLimit)
            : undefined
        }
      />
    </>
  );
};

export default Share;
