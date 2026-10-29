import { GetServerSidePropsContext } from "next";
import Meta from "../components/Meta";
import LazySection from "../components/core/LazySection";
import TrendingCountries, {
  TrendingCountriesSkeleton,
} from "../components/share/TrendingCountries";
import TrendingToday from "../components/share/TrendingToday";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import {
  setNoStoreHeaders,
  setPublicCacheHeaders,
} from "../utils/httpCache.util";
import {
  fetchShareList,
  fetchTrendingCountries,
} from "../utils/seo.server.util";
import { buildCollectionPage, buildItemList } from "../utils/seo.util";
import { TrendingCountry, TrendingShare } from "../types/share.type";
import { getShareThumbnailUrl } from "../utils/file.util";

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
  if (
    req.url?.startsWith("/_next/data/") ||
    initialItems === null ||
    initialCountries === null
  )
    setNoStoreHeaders(res);
  else setPublicCacheHeaders(res, 60, 30);
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
  const jsonLd = buildCollectionPage({
    name: t("trending.custom.title"),
    description,
    path: "/trending",
    siteName,
    baseUrl,
    mainEntity: buildItemList(
      initialItems.slice(0, 50).map((item) => ({
        name: item.name?.trim() || item.id,
        path: `/share/${item.id}`,
        image: getShareThumbnailUrl(item.id, item.updatedAt),
      })),
      baseUrl,
    ),
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
