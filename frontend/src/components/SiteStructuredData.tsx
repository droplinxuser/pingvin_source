import { useRouter } from "next/router";
import { useIntl } from "react-intl";
import useSiteMeta from "../hooks/siteMeta.hook";
import { isPublicPageRoute } from "../utils/router.util";
import {
  absoluteUrl,
  buildWebsiteRef,
  DEFAULT_SITE_DESCRIPTION,
} from "../utils/seo.util";
import JsonLd from "./JsonLd";

const SiteStructuredData = () => {
  const router = useRouter();
  const intl = useIntl();
  const { siteName, baseUrl } = useSiteMeta();
  if (!isPublicPageRoute(router.pathname)) return null;

  if (!baseUrl) return null;

  const websiteId = `${baseUrl}/#website`;
  const organizationId = `${baseUrl}/#organization`;
  const logo = absoluteUrl("/img/logo.png", baseUrl);
  const description = intl.formatMessage({
    id: "seo.custom.defaultDescription",
    defaultMessage: DEFAULT_SITE_DESCRIPTION,
  });

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": organizationId,
            name: siteName,
            url: baseUrl,
            logo: {
              "@type": "ImageObject",
              url: logo,
            },
          },
          {
            ...buildWebsiteRef(siteName, baseUrl),
            "@id": websiteId,
            description,
            inLanguage: intl.locale,
            publisher: { "@id": organizationId },
          },
        ],
      }}
    />
  );
};

export default SiteStructuredData;
