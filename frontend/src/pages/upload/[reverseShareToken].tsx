import { LoadingOverlay } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { GetServerSidePropsContext } from "next";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import Upload from ".";
import ShareLoadError from "../../components/share/ShareLoadError";
import showErrorModal from "../../components/share/showErrorModal";
import shareService from "../../services/share.service";
import useTranslate from "../../hooks/useTranslate.hook";

export function getServerSideProps(context: GetServerSidePropsContext) {
  return {
    props: { reverseShareToken: context.params!.reverseShareToken },
  };
}

const Share = ({ reverseShareToken }: { reverseShareToken: string }) => {
  const modals = useModals();
  const t = useTranslate();
  const [isLoading, setIsLoading] = useState(true);
  const [isInvalid, setIsInvalid] = useState(false);

  const [maxShareSize, setMaxShareSize] = useState(0);
  const [simplified, setSimplified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsInvalid(false);

    shareService
      .setReverseShare(reverseShareToken)
      .then((reverseShareTokenData) => {
        if (cancelled) return;
        setMaxShareSize(parseInt(reverseShareTokenData.maxShareSize));
        setSimplified(reverseShareTokenData.simplified);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsInvalid(true);
        showErrorModal(
          modals,
          t("upload.reverse-share.error.invalid.title"),
          t("upload.reverse-share.error.invalid.description"),
          "go-home",
        );
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reverseShareToken]);

  if (isLoading) return <LoadingOverlay visible />;

  if (isInvalid) {
    return (
      <ShareLoadError
        title={
          <FormattedMessage id="upload.reverse-share.error.invalid.title" />
        }
        description={
          <FormattedMessage id="upload.reverse-share.error.invalid.description" />
        }
      />
    );
  }

  return (
    <Upload
      isReverseShare
      maxShareSize={maxShareSize}
      simplified={simplified}
    />
  );
};

export default Share;
