import { GetServerSidePropsContext } from "next";
import Meta from "../components/Meta";
import LazySection from "../components/core/LazySection";
import TrendingCountries, {
  TrendingCountriesSkeleton,
} from "../components/share/TrendingCountries";
import TrendingToday from "../components/share/TrendingToday";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import { setListingCacheHeaders } from "../utils/httpCache.util";
import {
  fetchShareList,
  fetchTrendingCountries,
} from "../utils/seo.server.util";
import { buildShareListCollectionPage } from "../utils/seo.util";
import { TrendingCountry, TrendingShare } from "../types/share.type";

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const [initialItems, initialCountries] = await Promise.all([
    fetchShareList(apiURL, "trending", 200),
    fetchTrendingCountries(apiURL),
  ]);
  // Never let the CDN cache a failed backend response or an empty
  // client-navigation payload; the client retries both.
  setListingCacheHeaders(
    req,
    res,
    initialItems !== null && initialCountries !== null,
  );
  return {
    props: {
      initialItems: initialItems ?? [],
      initialCountries: initialCountries ?? [],
    },
  };
}

const Trending = ({
  initialItems = [],
  initialCountries = [],
}: {
  initialItems?: TrendingShare[];
  initialCountries?: TrendingCountry[];
}) => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("seo.custom.trending.description");
  const jsonLd = buildShareListCollectionPage({
    items: initialItems,
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
      <TrendingToday
        embedded
        limit={200}
        previewBlur={2}
        initialItems={initialItems}
      >
        <LazySection
          placeholder={<TrendingCountriesSkeleton />}
          rootMargin="400px"
        >
          <TrendingCountries countries={initialCountries} />
        </LazySection>
      </TrendingToday>
    </>
  );
};

export default Trending;
