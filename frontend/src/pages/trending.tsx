import Meta from "../components/Meta";
import LazySection from "../components/core/LazySection";
import TrendingCountries, {
  TrendingCountriesSkeleton,
} from "../components/share/TrendingCountries";
import TrendingToday from "../components/share/TrendingToday";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import { buildCollectionPage } from "../utils/seo.util";

const Trending = () => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("seo.custom.trending.description");
  const jsonLd = buildCollectionPage({
    name: t("trending.custom.title"),
    description,
    path: "/trending",
    siteName,
    baseUrl,
  });

  return (
    <>
      <Meta
        title={t("trending.custom.title")}
        description={description}
        canonicalPath="/trending"
        jsonLd={jsonLd}
      />
      <TrendingToday embedded limit={100} previewBlur={2}>
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
