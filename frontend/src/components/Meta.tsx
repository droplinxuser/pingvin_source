import Head from "next/head";
import { useRouter } from "next/router";
import { useIntl } from "react-intl";
import useSiteMeta from "../hooks/siteMeta.hook";
import { isPublicPageRoute } from "../utils/router.util";
import {
  absoluteUrl,
  DEFAULT_SITE_DESCRIPTION,
  getCanonicalPath,
} from "../utils/seo.util";
import JsonLd from "./JsonLd";

const Meta = ({
  title,
  description,
  image,
  type = "website",
  noindex,
  canonicalPath,
  jsonLd,
  publishedTime,
  modifiedTime,
}: {
  title?: string;
  description?: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  canonicalPath?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  publishedTime?: string;
  modifiedTime?: string;
}) => {
  const router = useRouter();
  const intl = useIntl();
  const { siteName, baseUrl } = useSiteMeta();
  const metaTitle = title ? `${title} - ${siteName}` : siteName;
  const metaDescription =
    description?.trim() ||
    intl.formatMessage({
      id: "seo.custom.defaultDescription",
      defaultMessage: DEFAULT_SITE_DESCRIPTION,
    });
  const path = canonicalPath ?? getCanonicalPath(router.asPath);
  const canonical = absoluteUrl(path, baseUrl);
  const imageUrl = absoluteUrl(image ?? "/img/og-image.png", baseUrl);
  const indexable =
    noindex === true
      ? false
      : noindex === false
        ? true
        : isPublicPageRoute(router.pathname);
  const robots = indexable
    ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
    : "noindex, nofollow";
  const locale = intl.locale.replace("-", "_");

  return (
    <>
      <Head>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta name="robots" content={robots} />
        <link rel="canonical" href={canonical} />

        <meta property="og:type" content={type} />
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={canonical} />
        <meta property="og:locale" content={locale} />
        <meta property="og:image" content={imageUrl} />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={`${siteName} logo`} />
        {publishedTime && (
          <meta property="article:published_time" content={publishedTime} />
        )}
        {modifiedTime && (
          <meta property="article:modified_time" content={modifiedTime} />
        )}

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDescription} />
        <meta name="twitter:image" content={imageUrl} />
        <meta name="twitter:image:alt" content={`${siteName} logo`} />
      </Head>
      {jsonLd && <JsonLd data={jsonLd} />}
    </>
  );
};

export default Meta;
