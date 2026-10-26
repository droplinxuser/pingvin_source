import { GetServerSidePropsContext } from "next";
import Meta from "../components/Meta";
import LazySection from "../components/core/LazySection";
import TrendingCountries, {
  TrendingCountriesSkeleton,
} from "../components/share/TrendingCountries";
import TrendingToday from "../components/share/TrendingToday";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import { fetchShareList } from "../utils/seo.server.util";
import { buildCollectionPage, buildItemList } from "../utils/seo.util";
import { TrendingShare } from "../types/share.type";
import { getShareThumbnailUrl } from "../utils/file.util";

export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const initialItems = await fetchShareList(apiURL, "trending", 100);
  setPublicCacheHeaders(res, 60, 30);
  return { props: { initialItems } };
}

const Trending = ({ initialItems }: { initialItems: TrendingShare[] }) => {
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
        limit={100}
        previewBlur={2}
        initialItems={initialItems}
      >
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
