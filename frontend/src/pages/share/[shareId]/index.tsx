import {
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Center,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
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
import {
  setNoStoreHeaders,
  setPublicCacheHeaders,
} from "../../../utils/httpCache.util";
import { isLikelyGalleryMedia } from "../../../utils/mime.util";
import { getQueryString } from "../../../utils/router.util";
import { fetchShareSeo } from "../../../utils/seo.server.util";
import {
  buildBreadcrumbList,
  buildCollectionPage,
  getShareContentKinds,
  getShareFileNames,
  getShareSubject,
  truncateMetaText,
} from "../../../utils/seo.util";

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
  if (result.status === "ok") {
    // Only a public, indexable share may produce a shared cache entry. A
    // protected or removed share must not keep serving its old title,
    // description or file names from the CDN for the TTL window.
    if (seo?.indexable === true) {
      if (context.req.url?.startsWith("/_next/data/"))
        setNoStoreHeaders(context.res);
      else setPublicCacheHeaders(context.res, 60, 30);
    } else {
      setNoStoreHeaders(context.res);
    }
  }
  if (initialNotFound) {
    // A share can be created or unlocked after this response; do not let the
    // CDN pin the 404/skeleton for a minute.
    setNoStoreHeaders(context.res);
  }
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
  const intl = useIntl();
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
  const shareName = share?.name || seo?.name;
  const displayFileCount = share?.files?.length ?? seo?.fileCount ?? 0;
  const displaySize = share?.size ?? seo?.size ?? 0;
  const subject = useMemo(
    () => (indexable ? getShareSubject(share ?? seo) : undefined),
    [indexable, seo, share],
  );
  const galleryThumbnailUrl = indexable ? seo?.thumbnailUrl : undefined;
  // Keep the visible H1/breadcrumb complete; only the meta title is shortened.
  const displayName = shareName || subject || shareId;
  const displayDescription = share?.description || seo?.description;
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
    ? subject
      ? displayFileCount === 1
        ? t("seo.custom.share.title.single", { name: subject })
        : t("seo.custom.share.title", {
            name: subject,
            count: displayFileCount,
          })
      : displayFileCount > 0
        ? t("seo.custom.share.title.count", { count: displayFileCount })
        : t("share.title", { shareId })
    : t("share.title", { shareId });
  const customDescription = truncateMetaText(
    (share?.description || seo?.description || "").trim(),
    90,
  );
  const excerptNames = getShareFileNames(seo?.files, 2).map((name) =>
    truncateMetaText(name, 30),
  );
  const singleFileName = getShareFileNames(seo?.files, 1)[0];
  const remainingNames = Math.max(displayFileCount - excerptNames.length, 0);
  const filesExcerpt = excerptNames.length
    ? `${excerptNames.join(", ")}${
        remainingNames > 0
          ? ` ${t("seo.custom.share.moreFiles", { count: remainingNames })}`
          : ""
      }`
    : "";
  const contentKinds = getShareContentKinds(seo?.files);
  const contentSummary = contentKinds.length
    ? new Intl.ListFormat(intl.locale, {
        style: "long",
        type: "conjunction",
      }).format(
        contentKinds.map((kind) => t(`seo.custom.share.content.${kind}`)),
      )
    : "";
  const metaDescription = indexable
    ? customDescription
      ? t("seo.custom.share.description.named", {
          description: customDescription,
          count: displayFileCount,
          size: byteToHumanSizeString(displaySize),
          siteName,
        })
      : displayFileCount === 1 && singleFileName
        ? t("seo.custom.share.description.single", {
            name: truncateMetaText(singleFileName, 60),
            size: byteToHumanSizeString(displaySize),
            siteName,
          })
        : filesExcerpt && contentSummary
          ? t("seo.custom.share.description.content", {
              count: displayFileCount,
              size: byteToHumanSizeString(displaySize),
              siteName,
              content: contentSummary,
              files: filesExcerpt,
            })
          : filesExcerpt
            ? t("seo.custom.share.description.files", {
                count: displayFileCount,
                size: byteToHumanSizeString(displaySize),
                siteName,
                files: filesExcerpt,
              })
            : t("seo.custom.share.description", {
                count: displayFileCount,
                size: byteToHumanSizeString(displaySize),
                siteName,
              })
    : t("share.description");
  const shareJsonLd =
    indexable && seo
      ? [
          buildBreadcrumbList(
            [
              { name: t("seo.custom.breadcrumb.home"), path: "/" },
              { name: t("trending.custom.title"), path: "/trending" },
              { name: displayName, path: `/share/${shareId}` },
            ],
            baseUrl,
          ),
          buildCollectionPage({
            name: metaTitle,
            description: metaDescription,
            path: `/share/${shareId}`,
            siteName,
            baseUrl,
            datePublished: seo.createdAt,
            dateModified: seo.updatedAt,
            image: seo.thumbnailUrl,
            mainEntity: {
              "@type": "ItemList",
              // The SEO payload samples the first 50 files; keep the declared
              // count equal to the emitted entries.
              numberOfItems: (seo.files ?? []).length,
              itemListElement: (seo.files ?? []).map((file, position) => ({
                "@type": "ListItem",
                position: position + 1,
                name: getBaseName(file.name),
                // A nested item keeps the entry complete for rich-result
                // consumers without pointing at a non-indexable API URL.
                item: {
                  "@type": "DigitalDocument",
                  name: getBaseName(file.name),
                },
              })),
            },
          }),
        ]
      : undefined;
  const shareMeta = (
    <Meta
      title={truncateMetaText(metaTitle, 70)}
      description={metaDescription}
      type="article"
      noindex={!indexable}
      canonicalPath={`/share/${shareId}`}
      image={indexable ? seo?.thumbnailUrl : undefined}
      imageType={indexable && seo?.thumbnailUrl ? "image/webp" : undefined}
      imageAlt={indexable ? displayName : undefined}
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
        // Non-sensitive browser hint: this visitor already unlocked the share,
        // so a reload can call the API directly instead of showing the modal
        // and logging a guaranteed 403.
        try {
          window.localStorage.setItem(`share_ready_${shareId}`, "1");
        } catch {
          // Storage can be disabled; the modal simply appears again.
        }
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
        } else if (
          error == "share_password_required" ||
          error == "wrong_password"
        ) {
          // An initial probe opens the form; a submitted password rejects so
          // the same form can render its inline error.
          if (password === undefined)
            showEnterPasswordModal(modals, getShareToken);
          else throw e;
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
          if (seo?.requiresPassword)
            showEnterPasswordModal(modals, getShareToken);
          else getShareToken();
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
    if (initialNotFound) return;

    // The SEO payload already tells us whether the share is password
    // protected. Open the gate directly instead of issuing a GET that is
    // guaranteed to fail with 403 (and show up as a console error).
    if (
      seo?.requiresPassword &&
      !window.localStorage.getItem(`share_ready_${shareId}`)
    ) {
      showEnterPasswordModal(modals, getShareToken);
      return;
    }

    getFiles();
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
        <Ads />
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

      <Box
        mb="lg"
        sx={(theme) => ({
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "start",
          gap: theme.spacing.md,
          [theme.fn.smallerThan("sm")]: {
            gridTemplateColumns: "minmax(0, 1fr)",
          },
        })}
      >
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
            indexable && (
              <Box mt={5}>
                <Skeleton height={44} width="100%" />
              </Box>
            )
          )}
        </Box>

        <ShareActions
          share={share}
          shareId={shareId}
          recipientId={recipientId}
          fileCount={displayFileCount}
          setShare={setShare}
          onDeleted={() => router.replace(homeHref)}
        />
      </Box>

      <LazySection
        placeholder={
          <MediaPreviewGallerySkeleton
            count={galleryPlaceholderCount}
            thumbnailUrl={galleryThumbnailUrl}
          />
        }
        rootMargin="600px"
        busy={!share}
      >
        {share ? (
          <MediaPreviewGallery
            shareId={shareId}
            files={share.files}
            posterUrl={galleryThumbnailUrl}
          />
        ) : (
          <MediaPreviewGallerySkeleton
            count={galleryPlaceholderCount}
            thumbnailUrl={galleryThumbnailUrl}
          />
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
