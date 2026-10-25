import Meta from "../components/Meta";
import LazySection from "../components/core/LazySection";
import TrendingCountries, {
  TrendingCountriesSkeleton,
} from "../components/share/TrendingCountries";
import TrendingToday from "../components/share/TrendingToday";
import useConfig from "../hooks/config.hook";
import useTranslate from "../hooks/useTranslate.hook";
import { absoluteUrl, normalizeBaseUrl } from "../utils/seo.util";

const Trending = () => {
  const t = useTranslate();
  const config = useConfig();
  const siteName =
    (config.get("general.appName") as string)?.trim() || "Pingvin Share";
  const baseUrl = normalizeBaseUrl(config.get("general.appUrl") as string);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("trending.custom.title"),
    description: t("seo.custom.trending.description"),
    url: absoluteUrl("/trending", baseUrl),
    isPartOf: {
      "@type": "WebSite",
      name: siteName,
      url: absoluteUrl("/", baseUrl),
    },
  };

  return (
    <>
      <Meta
        title={t("trending.custom.title")}
        description={t("seo.custom.trending.description")}
        canonicalPath="/trending"
        jsonLd={jsonLd}
      />
      <TrendingToday embedded limit={48} previewBlur={4}>
        <LazySection
          placeholder={<TrendingCountriesSkeleton />}
          rootMargin="400px"
        >
          <TrendingCountries />
        </LazySection>
      </TrendingToday>
    </>
  );
};

export default Trending;
