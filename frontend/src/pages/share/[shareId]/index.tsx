import { Box, Group, Text, Title } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { GetServerSidePropsContext } from "next";
import { useEffect, useState } from "react";
import Meta from "../../../components/Meta";
import DownloadAllButton from "../../../components/share/DownloadAllButton";
import FileList from "../../../components/share/FileList";
import showEnterPasswordModal from "../../../components/share/showEnterPasswordModal";
import showErrorModal from "../../../components/share/showErrorModal";
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
  const modals = useModals();
  const [share, setShare] = useState<ShareType>();
  const t = useTranslate();

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
        } else {
          toast.axiosError(e);
        }
      });
  };

  const getFiles = async () => {
    shareService
      .get(shareId)
      .then((share) => {
        setShare(share);
      })
      .catch((e) => {
        const { error } = e.response.data;
        if (e.response.status == 404) {
          if (error == "share_removed") {
            showErrorModal(
              modals,
              t("share.error.removed.title"),
              e.response.data.message,
              "go-home",
            );
          } else {
            showErrorModal(
              modals,
              t("share.error.not-found.title"),
              t("share.error.not-found.description"),
              "go-home",
            );
          }
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
    getFiles();

    // Dynamically load the Adsterra script
    const script = document.createElement('script');
    script.src = '//pl22899864.profitablegatecpm.com/4d/69/6f/4d696fd2a6a11010f9f9e4cdbadc5907.js';
    script.type = 'text/javascript';
    script.async = true;
    document.body.appendChild(script);

    // Optional: Cleanup on component unmount
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <>
      <Meta
        title={t("share.title", { shareId })}
        description={t("share.description")}
      />

      <Group position="apart" mb="lg">
        <Box style={{ maxWidth: "70%" }}>
          <Title order={3}>{share?.id}</Title>
          <Text size="sm">{share?.description}</Text>
        </Box>
        {share?.files.length > 1 && <DownloadAllButton shareId={shareId} />}
      </Group>

      <FileList
        files={share?.files}
        setShare={setShare}
        share={share!}
        isLoading={!share}
      />
    </>
  );
};

export default Share;
