import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { useModals } from "@mantine/modals";
import Link from "next/link";
import { Dispatch, SetStateAction } from "react";
import { FormattedMessage } from "react-intl";
import {
  TbDownload,
  TbEdit,
  TbFlag,
  TbPlusMinus,
  TbTrash,
} from "react-icons/tb";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import useUser from "../../hooks/user.hook";
import shareService from "../../services/share.service";
import { MyShare, Share } from "../../types/share.type";
import toast from "../../utils/toast.util";
import { HoverTip } from "../core/HoverTip";
import DownloadAllButton from "./DownloadAllButton";

const ShareActions = ({
  share,
  shareId,
  recipientId,
  fileCount,
  setShare,
  onDeleted,
}: {
  share?: Share;
  shareId: string;
  recipientId?: string;
  fileCount?: number;
  setShare: Dispatch<SetStateAction<Share | undefined>>;
  onDeleted: () => void;
}) => {
  const modals = useModals();
  const { user } = useUser();
  const config = useConfig();
  const t = useTranslate();

  const isOwner = !!user && !!share && share.creator?.id === user.id;
  const isOwnerOrAdmin =
    !!user && !!share && (share.creator?.id === user.id || user.isAdmin);

  const handleEditClick = async () => {
    if (!share) return;

    // Load the form (Mantine form, yup, QR code) only when an owner/admin
    // opens it instead of shipping it with every share page.
    const { default: showShareInformationsModal } =
      await import("./showShareInformationsModal");

    // The share page already contains everything the edit form needs, so a
    // second request for the user's whole share list is unnecessary. Using the
    // loaded share also lets an admin edit an anonymous reverse share, which
    // would never be present in getMyShares().
    const editableShare: MyShare = {
      ...share,
      recipients: [],
      security: {
        passwordProtected: share.hasPassword,
        maxViews: share.maxViews,
        restrictToRecipients: false,
      },
    };
    showShareInformationsModal(
      modals,
      editableShare,
      parseInt(config.get("share.maxSize")),
      config.get("general.appUrl"),
      config.get("general.appUrl", true),
      (updatedShare: MyShare) => {
        setShare((prev) =>
          prev
            ? {
                ...prev,
                name: updatedShare.name,
                description: updatedShare.description,
                expiration: updatedShare.expiration,
                hasPassword:
                  updatedShare.security?.passwordProtected ?? prev.hasPassword,
                maxViews: updatedShare.security?.maxViews,
              }
            : prev,
        );
      },
      true,
    );
  };

  const handleDeleteClick = () => {
    modals.openConfirmModal({
      title: t("admin.shares.edit.delete.title", { id: shareId }),
      children: (
        <Text size="sm">
          <FormattedMessage id="admin.shares.edit.delete.description" />
        </Text>
      ),
      labels: {
        confirm: t("common.button.delete"),
        cancel: t("common.button.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await shareService.remove(shareId);
          toast.success(t("admin.shares.custom.notify.deleted"));
          onDeleted();
        } catch (e) {
          toast.axiosError(e);
        }
      },
    });
  };

  const handleReportClick = async () => {
    const { default: showReportShareModal } =
      await import("./showReportShareModal");
    showReportShareModal(modals, shareId);
  };

  return (
    <Group spacing="xs">
      <Button
        variant="light"
        color="red.9"
        leftIcon={<TbFlag />}
        aria-label={t("share.custom.report.button")}
        onClick={handleReportClick}
      >
        <FormattedMessage id="share.custom.report.button" />
      </Button>
      {isOwner && (
        <HoverTip label={t("account.shares.button.edit")}>
          <Link href={`/share/${shareId}/edit`}>
            <ActionIcon
              variant="light"
              color="orange"
              size="lg"
              aria-label={t("account.shares.button.edit")}
            >
              <TbPlusMinus />
            </ActionIcon>
          </Link>
        </HoverTip>
      )}
      {isOwnerOrAdmin && (
        <HoverTip label={t("common.button.edit")}>
          <ActionIcon
            variant="light"
            color="blue"
            size="lg"
            aria-label={t("common.button.edit")}
            onClick={handleEditClick}
          >
            <TbEdit />
          </ActionIcon>
        </HoverTip>
      )}
      {user?.isAdmin && (
        <HoverTip label={t("common.button.delete")}>
          <ActionIcon
            variant="light"
            color="red"
            size="lg"
            aria-label={t("common.button.delete")}
            onClick={handleDeleteClick}
          >
            <TbTrash />
          </ActionIcon>
        </HoverTip>
      )}
      {share
        ? share.files.length > 1 && (
            <DownloadAllButton
              shareId={shareId}
              recipientId={recipientId}
              files={share.files}
            />
          )
        : (fileCount ?? 0) > 1 && (
            // Reserve the button before the share payload arrives. Without it
            // the action row wraps on phones and shifts the whole page (CLS).
            <Button
              variant="light"
              color="cyan"
              leftIcon={<TbDownload />}
              disabled
              aria-hidden
            >
              <FormattedMessage id="share.button.download-all" />
            </Button>
          )}
    </Group>
  );
};

export default ShareActions;
