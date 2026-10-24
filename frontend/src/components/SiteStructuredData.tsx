import { useRouter } from "next/router";
import { useIntl } from "react-intl";
import useConfig from "../hooks/config.hook";
import { isPublicPageRoute } from "../utils/router.util";
import {
  absoluteUrl,
  DEFAULT_SITE_DESCRIPTION,
  normalizeBaseUrl,
} from "../utils/seo.util";
import JsonLd from "./JsonLd";

const SiteStructuredData = () => {
  const config = useConfig();
  const router = useRouter();
  const intl = useIntl();
  if (!isPublicPageRoute(router.pathname)) return null;

  const siteName =
    (config.get("general.appName") as string)?.trim() || "Pingvin Share";
  const baseUrl = normalizeBaseUrl(config.get("general.appUrl") as string);
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
              width: 400,
              height: 400,
            },
          },
          {
            "@type": "WebSite",
            "@id": websiteId,
            url: baseUrl,
            name: siteName,
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
