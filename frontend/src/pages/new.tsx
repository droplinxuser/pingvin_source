import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useConfig from "../hooks/config.hook";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { absoluteUrl, normalizeBaseUrl } from "../utils/seo.util";

const NewShares = () => {
  const t = useTranslate();
  const config = useConfig();
  const siteName =
    (config.get("general.appName") as string)?.trim() || "Pingvin Share";
  const baseUrl = normalizeBaseUrl(config.get("general.appUrl") as string);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("new.custom.title"),
    description: t("seo.custom.new.description"),
    url: absoluteUrl("/new", baseUrl),
    isPartOf: {
      "@type": "WebSite",
      name: siteName,
      url: absoluteUrl("/", baseUrl),
    },
  };

  return (
    <>
      <Meta
        title={t("new.custom.title")}
        description={t("seo.custom.new.description")}
        canonicalPath="/new"
        jsonLd={jsonLd}
      />
      <TrendingToday
        embedded
        limit={100}
        previewBlur={4}
        loadItems={shareService.getRecent}
        showMediaTypeBadge
        title={t("new.custom.title")}
        description={t("new.custom.description")}
        loadingText={t("new.custom.loading")}
        emptyText={t("new.custom.empty")}
      />
    </>
  );
};

export default NewShares;
