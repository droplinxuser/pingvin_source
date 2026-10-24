import {
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Center,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
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
import useConfig from "../../../hooks/config.hook";
import useTranslate from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { Share as ShareType, ShareSeo } from "../../../types/share.type";
import toast from "../../../utils/toast.util";
import { getBaseName } from "../../../utils/file.util";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";
import { getQueryString } from "../../../utils/router.util";
import { fetchShareSeo } from "../../../utils/seo.server.util";
import { absoluteUrl, normalizeBaseUrl } from "../../../utils/seo.util";

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const shareId = context.params!.shareId as string;
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const result = await fetchShareSeo(apiURL, shareId);
  const seo = result.status === "ok" ? result.data : null;
  const initialNotFound = result.status === "not-found";

  // Keep the share-specific "not found" message rendered by the page, but make
  // the HTTP response itself a 404 so search engines do not index it.
  if (initialNotFound) context.res.statusCode = 404;

  return { props: { shareId, initialNotFound, seo } };
}

const SharePage = ({
  shareId,
  initialNotFound = false,
  seo,
}: {
  shareId: string;
  initialNotFound?: boolean;
  seo?: ShareSeo | null;
}) => {
  const modals = useModals();
  const router = useRouter();
  const config = useConfig();
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

  const siteName =
    (config.get("general.appName") as string)?.trim() || "Pingvin Share";
  const baseUrl = normalizeBaseUrl(config.get("general.appUrl") as string);
  const shareUrl = absoluteUrl(`/share/${shareId}`, baseUrl);
  const indexable = seo?.indexable === true;
  const shareName = indexable ? share?.name || seo?.name : undefined;
  const metaTitle = indexable
    ? shareName
      ? t("seo.custom.share.title", { name: shareName })
      : t("share.title", { shareId })
    : t("share.title", { shareId });
  const metaDescription = indexable
    ? t("seo.custom.share.description", {
        count: share?.files?.length ?? seo?.fileCount ?? 0,
        size: byteToHumanSizeString(share?.size ?? seo?.size ?? 0),
        siteName,
      })
    : t("share.description");
  const shareJsonLd =
    indexable && seo
      ? {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: shareName ? `${shareName} - ${siteName}` : metaTitle,
          description: metaDescription,
          url: shareUrl,
          datePublished: seo.createdAt,
          dateModified: seo.updatedAt,
          isPartOf: {
            "@type": "WebSite",
            name: siteName,
            url: absoluteUrl("/", baseUrl),
          },
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: seo.files?.length ?? 0,
            itemListElement: (seo.files ?? []).map((file, position) => ({
              "@type": "ListItem",
              position: position + 1,
              name: getBaseName(file.name),
            })),
          },
        }
      : undefined;
  const shareMeta = (
    <Meta
      title={metaTitle}
      description={metaDescription}
      type="article"
      noindex={!indexable}
      canonicalPath={`/share/${shareId}`}
      publishedTime={indexable ? seo?.createdAt : undefined}
      modifiedTime={indexable ? seo?.updatedAt : undefined}
      jsonLd={shareJsonLd}
      image="/img/og-image.png"
    />
  );

  const showRateLimitModal = () =>
    showErrorModal(
      modals,
      t("common.custom.rate-limit.title"),
      t("common.custom.rate-limit.description"),
      "go-home",
    );

  const getShareToken = async (password?: string) => {
    await shareService
      .getShareToken(shareId, password)
      .then(() => {
        modals.closeAll();
        getFiles();
      })
      .catch((e) => {
        if (!e.response) {
          toast.axiosError(e);
          return;
        }
        if (e.response.status == 429) {
          showRateLimitModal();
          return;
        }

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
      .get(shareId)
      .then((share) => {
        setPageError(null);
        setShare(share);
      })
      .catch((e) => {
        if (!e.response) {
          toast.axiosError(e);
          return;
        }
        if (e.response.status == 429) {
          showRateLimitModal();
          return;
        }

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
      <>
        {shareMeta}
        <Center style={{ height: "70vh" }}>
          <Stack align="center" spacing="md">
            <Title order={1} size="h3">
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
      </>
    );
  }

  if (pageError) {
    return (
      <>
        {shareMeta}
        <Center style={{ height: "70vh" }}>
          <Stack align="center" spacing="md">
            <Title order={1} size="h3">
              {pageError.title}
            </Title>
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
    <article aria-labelledby="share-title">
      {shareMeta}

      <Breadcrumbs mb="md" aria-label="Breadcrumb">
        <Anchor component={Link} href="/">
          {t("seo.custom.breadcrumb.home")}
        </Anchor>
        <Anchor component={Link} href="/trending">
          {t("trending.custom.title")}
        </Anchor>
        <Text>{share?.name || shareId}</Text>
      </Breadcrumbs>

      <Group position="apart" mb="lg">
        <Box style={{ maxWidth: "70%" }}>
          <Title order={1} size="h3" id="share-title">
            {share?.name || share?.id}
          </Title>
          <Text size="sm">{share?.description}</Text>
          {share?.files?.length > 0 && (
            <Text size="sm" color="dimmed" mt={5}>
              <FormattedMessage
                id="share.fileCount"
                values={{
                  count: share?.files?.length || 0,
                  size: byteToHumanSizeString(share?.size || 0),
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
          onDeleted={() => router.replace("/")}
        />
      </Group>

      <MediaPreviewGallery shareId={shareId} files={share?.files} />

      <Ads />

      <FileList
        files={share?.files}
        share={share!}
        isLoading={!share}
        recipientId={recipientId}
      />

      {share && <ShareStats share={share} />}
    </article>
  );
};

// Remount when navigating between shares so the previous share's files and
// visitor data cannot stay on screen under the new share URL.
const Share = (props: { shareId: string; initialNotFound?: boolean }) => (
  <SharePage key={props.shareId} {...props} />
);

export default Share;
