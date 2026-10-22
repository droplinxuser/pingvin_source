import { Box, Button, Center, Group, Stack, Text, Title } from "@mantine/core";
import { useModals } from "@mantine/modals";
import axios from "axios";
import { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import Meta from "../../../components/Meta";
import FileList from "../../../components/share/FileList";
import MediaPreviewGallery from "../../../components/share/MediaPreviewGallery";
import ShareActions from "../../../components/share/ShareActions";
import ShareStats from "../../../components/share/ShareStats";
import UploaderInfoBadges from "../../../components/share/UploaderInfoBadges";
import Ads from "../../../components/Ads";
import showEnterPasswordModal from "../../../components/share/showEnterPasswordModal";
import showErrorModal from "../../../components/share/showErrorModal";
import useTranslate from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { Share as ShareType } from "../../../types/share.type";
import toast from "../../../utils/toast.util";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";
import { getQueryString } from "../../../utils/router.util";
import { getExternalReferrer } from "../../../utils/share.util";

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const shareId = context.params!.shareId as string;
  const apiURL = process.env.API_URL || "http://localhost:8080";
  let initialNotFound = false;

  try {
    await axios.head(`${apiURL}/api/shares/${encodeURIComponent(shareId)}`);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const status = e.response?.status;
      // Keep the share-specific "not found" message rendered by the page,
      // but make the HTTP response itself a 404.
      if (status === 400 || status === 404) {
        context.res.statusCode = 404;
        initialNotFound = true;
      }
    }
  }

  return { props: { shareId, initialNotFound } };
}

const Share = ({
  shareId,
  initialNotFound = false,
}: {
  shareId: string;
  initialNotFound?: boolean;
}) => {
  const modals = useModals();
  const router = useRouter();
  const t = useTranslate();

  const [share, setShare] = useState<ShareType>();
  const [isRestricted, setIsRestricted] = useState(false);
  const [pageError, setPageError] = useState<{
    title: string;
    description: string;
  } | null>(() =>
    initialNotFound
      ? {
          title: t("share.error.not-found.title"),
          description: t("share.error.not-found.description"),
        }
      : null,
  );

  const recipientId = getQueryString(router.query.recipient);

  const getShareToken = async (password?: string) => {
    await shareService
      .getShareToken(shareId, password)
      .then(() => {
        modals.closeAll();
        getFiles();
      })
      .catch((e) => {
        const { error } = e.response.data;
        if (error == "share_max_views_exceeded") {
          showErrorModal(
            modals,
            t("share.error.visitor-limit-exceeded.title"),
            t("share.error.visitor-limit-exceeded.description"),
            "go-home",
          );
        } else if (error == "share_password_required") {
          showEnterPasswordModal(modals, getShareToken);
        } else {
          toast.axiosError(e);
        }
      });
  };

  const getFiles = async () => {
    shareService
      .get(shareId, getExternalReferrer())
      .then((share) => {
        setPageError(null);
        setShare(share);
      })
      .catch((e) => {
        const { error } = e.response.data;
        if (e.response.status == 404) {
          setPageError(
            error == "share_removed"
              ? {
                  title: t("share.error.removed.title"),
                  description: e.response.data.message,
                }
              : {
                  title: t("share.error.not-found.title"),
                  description: t("share.error.not-found.description"),
                },
          );
        } else if (
          e.response.status == 403 &&
          error == "share_max_views_exceeded"
        ) {
          showErrorModal(
            modals,
            t("share.error.visitor-limit-exceeded.title"),
            t("share.error.visitor-limit-exceeded.description"),
            "go-home",
          );
        } else if (
          e.response.status == 403 &&
          error == "share_restricted_to_recipients"
        ) {
          setIsRestricted(true);
        } else if (e.response.status == 403 && error == "private_share") {
          showErrorModal(
            modals,
            t("share.error.access-denied.title"),
            t("share.error.access-denied.description"),
          );
        } else if (error == "share_password_required") {
          showEnterPasswordModal(modals, getShareToken);
        } else if (error == "share_token_required") {
          getShareToken();
        } else {
          showErrorModal(
            modals,
            t("common.error"),
            t("common.error.unknown"),
            "go-home",
          );
        }
      });
  };

  useEffect(() => {
    if (!initialNotFound) getFiles();
  }, []);

  if (isRestricted) {
    return (
      <Center style={{ height: "70vh" }}>
        <Stack align="center" spacing="md">
          <Title order={3}>
            <FormattedMessage id="share.error.restricted.title" />
          </Title>
          <Text color="dimmed" align="center">
            <FormattedMessage id="share.error.restricted.description" />
          </Text>
          <Button
            component={Link}
            href={`/auth/signIn?redirect=/share/${shareId}`}
          >
            <FormattedMessage id="share.error.restricted.button" />
          </Button>
        </Stack>
      </Center>
    );
  }

  if (pageError) {
    return (
      <>
        <Meta
          title={t("share.title", { shareId })}
          description={t("share.description")}
        />
        <Center style={{ height: "70vh" }}>
          <Stack align="center" spacing="md">
            <Title order={3}>{pageError.title}</Title>
            <Text color="dimmed" align="center">
              {pageError.description}
            </Text>
            <Button component={Link} href="/">
              <FormattedMessage id="common.button.go-home" />
            </Button>
          </Stack>
        </Center>
        <Ads />
      </>
    );
  }

  return (
    <>
      <Meta
        title={t("share.title", { shareId: share?.name || shareId })}
        description={t("share.description")}
      />

      <Group position="apart" mb="lg">
        <Box style={{ maxWidth: "70%" }}>
          <Title order={3}>{share?.name || share?.id}</Title>
          <Text size="sm">{share?.description}</Text>
          {share?.files?.length > 0 && (
            <Text size="sm" color="dimmed" mt={5}>
              <FormattedMessage
                id="share.fileCount"
                values={{
                  count: share?.files?.length || 0,
                  size: byteToHumanSizeString(
                    share?.files?.reduce(
                      (total: number, file: { size: string }) =>
                        total + parseInt(file.size),
                      0,
                    ) || 0,
                  ),
                }}
              />
            </Text>
          )}
          {share && (
            <Group spacing="xs" mt={5}>
              <UploaderInfoBadges share={share} info={share.uploaderInfo} />
            </Group>
          )}
        </Box>

        <ShareActions
          share={share}
          shareId={shareId}
          recipientId={recipientId}
          setShare={setShare}
          onDeleted={getFiles}
        />
      </Group>

      <MediaPreviewGallery shareId={shareId} files={share?.files} />

      <Ads />

      <FileList
        files={share?.files}
        setShare={setShare}
        share={share!}
        isLoading={!share}
        recipientId={recipientId}
      />

      {share && <ShareStats share={share} />}
    </>
  );
};

export default Share;
