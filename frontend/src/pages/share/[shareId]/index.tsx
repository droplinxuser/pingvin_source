import {
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Center,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import Meta from "../../../components/Meta";
import LazySection from "../../../components/core/LazySection";
import FileList, { FileListSkeleton } from "../../../components/share/FileList";
import MediaPreviewGallery, {
  MediaPreviewGallerySkeleton,
} from "../../../components/share/MediaPreviewGallery";
import ShareActions from "../../../components/share/ShareActions";
import ShareComments, {
  ShareCommentsSkeleton,
} from "../../../components/share/ShareComments";
import ShareStats, {
  ShareStatsSkeleton,
} from "../../../components/share/ShareStats";
import UploaderInfoBadges from "../../../components/share/UploaderInfoBadges";
import Ads from "../../../components/Ads";
import showEnterPasswordModal from "../../../components/share/showEnterPasswordModal";
import showErrorModal from "../../../components/share/showErrorModal";
import useHomeHref from "../../../hooks/homeHref.hook";
import useSiteMeta from "../../../hooks/siteMeta.hook";
import useTranslate from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { Share as ShareType, ShareSeo } from "../../../types/share.type";
import toast from "../../../utils/toast.util";
import { getBaseName } from "../../../utils/file.util";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";
import { setNoStoreHeaders } from "../../../utils/httpCache.util";
import { isLikelyGalleryMedia } from "../../../utils/mime.util";
import { getQueryString } from "../../../utils/router.util";
import { fetchShareSeo } from "../../../utils/seo.server.util";
import { buildCollectionPage } from "../../../utils/seo.util";

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const shareId = context.params!.shareId as string;
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const result = await fetchShareSeo(apiURL, shareId);
  const seo = result.status === "ok" ? result.data : null;
  const initialNotFound = result.status === "not-found";

  // Keep the share-specific "not found" message rendered by the page, but make
  // the HTTP response itself a 404 so search engines do not index it. A
  // transient metadata failure gets a 503 instead of a 200 noindex page, so a
  // short backend outage cannot deindex a valid public share.
  if (initialNotFound) context.res.statusCode = 404;
  if (result.status === "error") {
    context.res.statusCode = 503;
    setNoStoreHeaders(context.res);
  }

  return { props: { shareId, initialNotFound, seo } };
}

/**
 * Full-page message used by the restricted and missing/removed share states.
 * Both branches previously duplicated the same centered stack.
 */
const ShareMessage = ({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: ReactNode;
  action: { href: string; label: ReactNode };
}) => (
  <Center style={{ height: "70vh" }}>
    <Stack align="center" spacing="md">
      <Title order={1} size="h3">
        {title}
      </Title>
      <Text color="dimmed" align="center">
        {description}
      </Text>
      <Button component={Link} href={action.href}>
        {action.label}
      </Button>
    </Stack>
  </Center>
);

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
  const homeHref = useHomeHref();
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();

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

  const indexable = seo?.indexable === true;
  const shareName = indexable ? share?.name || seo?.name : undefined;
  const displayName = share?.name || seo?.name || shareId;
  const displayDescription = share?.description || seo?.description;
  const displayFileCount = share?.files?.length ?? seo?.fileCount ?? 0;
  const displaySize = share?.size ?? seo?.size ?? 0;
  const skeletonMediaCount = indexable
    ? (seo?.files ?? []).filter((file) => isLikelyGalleryMedia(file.name))
        .length
    : 0;
  const galleryPlaceholderCount = Math.min(
    share
      ? share.files.filter((file: { name: string }) =>
          isLikelyGalleryMedia(file.name),
        ).length
      : skeletonMediaCount,
    30,
  );
  const hasGalleryMedia = galleryPlaceholderCount > 0;
  const fileSkeletonCount = displayFileCount || 5;
  const metaTitle = indexable
    ? shareName
      ? t("seo.custom.share.title", { name: shareName })
      : t("share.title", { shareId })
    : t("share.title", { shareId });
  const metaDescription = indexable
    ? t("seo.custom.share.description", {
        count: displayFileCount,
        size: byteToHumanSizeString(displaySize),
        siteName,
      })
    : t("share.description");
  const shareJsonLd =
    indexable && seo
      ? buildCollectionPage({
          name: shareName ? `${shareName} - ${siteName}` : metaTitle,
          description: metaDescription,
          path: `/share/${shareId}`,
          siteName,
          baseUrl,
          datePublished: seo.createdAt,
          dateModified: seo.updatedAt,
          image: seo.thumbnailUrl,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: seo.files?.length ?? 0,
            itemListElement: (seo.files ?? []).map((file, position) => ({
              "@type": "ListItem",
              position: position + 1,
              name: getBaseName(file.name),
            })),
          },
        })
      : undefined;
  const shareMeta = (
    <Meta
      title={metaTitle}
      description={metaDescription}
      type="article"
      noindex={!indexable}
      canonicalPath={`/share/${shareId}`}
      image={indexable ? seo?.thumbnailUrl : undefined}
      imageType={indexable && seo?.thumbnailUrl ? "image/webp" : undefined}
      imageAlt={indexable ? shareName || seo?.name || siteName : undefined}
      publishedTime={indexable ? seo?.createdAt : undefined}
      modifiedTime={indexable ? seo?.updatedAt : undefined}
      jsonLd={shareJsonLd}
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
        <ShareMessage
          title={<FormattedMessage id="share.error.restricted.title" />}
          description={
            <FormattedMessage id="share.error.restricted.description" />
          }
          action={{
            href: `/auth/signIn?redirect=/share/${shareId}`,
            label: <FormattedMessage id="share.error.restricted.button" />,
          }}
        />
      </>
    );
  }

  if (pageError) {
    return (
      <>
        {shareMeta}
        <ShareMessage
          title={pageError.title}
          description={pageError.description}
          action={{
            href: homeHref,
            label: <FormattedMessage id="common.button.go-home" />,
          }}
        />
        <Ads />
      </>
    );
  }

  return (
    <article aria-labelledby="share-title">
      {shareMeta}

      <Breadcrumbs mb="md" aria-label="Breadcrumb">
        <Anchor component={Link} href={homeHref}>
          {t("seo.custom.breadcrumb.home")}
        </Anchor>
        <Anchor component={Link} href="/trending">
          {t("trending.custom.title")}
        </Anchor>
        <Text truncate maw={{ base: 160, sm: 420 }}>
          {displayName}
        </Text>
      </Breadcrumbs>

      <Group position="apart" mb="lg">
        <Box style={{ maxWidth: "70%" }}>
          <Title
            order={1}
            size="h3"
            id="share-title"
            sx={{ overflowWrap: "anywhere" }}
          >
            {displayName}
          </Title>
          <Text size="sm" sx={{ overflowWrap: "anywhere" }}>
            {displayDescription}
          </Text>
          {displayFileCount > 0 && (
            <Text size="sm" color="dimmed" mt={5}>
              <FormattedMessage
                id="share.custom.fileCount"
                values={{
                  count: displayFileCount,
                  size: byteToHumanSizeString(displaySize),
                }}
              />
            </Text>
          )}
          {share ? (
            <Box mt={5}>
              <UploaderInfoBadges share={share} info={share.uploaderInfo} />
            </Box>
          ) : (
            indexable && <Skeleton height={16} width={210} mt={7} />
          )}
        </Box>

        <ShareActions
          share={share}
          shareId={shareId}
          recipientId={recipientId}
          setShare={setShare}
          onDeleted={() => router.replace(homeHref)}
        />
      </Group>

      <LazySection
        placeholder={
          <MediaPreviewGallerySkeleton count={galleryPlaceholderCount} />
        }
        rootMargin="600px"
        busy={!share}
      >
        {share ? (
          <MediaPreviewGallery shareId={shareId} files={share.files} />
        ) : (
          <MediaPreviewGallerySkeleton count={galleryPlaceholderCount} />
        )}
      </LazySection>

      <Ads gallery={hasGalleryMedia} />

      <LazySection
        placeholder={<FileListSkeleton count={fileSkeletonCount} />}
        rootMargin="400px"
        busy={!share}
      >
        <FileList
          files={share?.files}
          share={share!}
          isLoading={!share}
          recipientId={recipientId}
          skeletonCount={fileSkeletonCount}
        />
      </LazySection>

      <LazySection
        placeholder={<ShareCommentsSkeleton />}
        rootMargin="400px"
        busy={!share}
      >
        {share ? (
          <ShareComments
            shareId={shareId}
            initialVersion={share.commentsVersion ?? 0}
          />
        ) : (
          <ShareCommentsSkeleton />
        )}
      </LazySection>

      <LazySection
        placeholder={<ShareStatsSkeleton />}
        rootMargin="400px"
        busy={!share}
      >
        {share ? <ShareStats share={share} /> : <ShareStatsSkeleton />}
      </LazySection>
    </article>
  );
};

// Remount when navigating between shares so the previous share's files and
// visitor data cannot stay on screen under the new share URL.
const Share = (props: { shareId: string; initialNotFound?: boolean }) => (
  <SharePage key={props.shareId} {...props} />
);

export default Share;
