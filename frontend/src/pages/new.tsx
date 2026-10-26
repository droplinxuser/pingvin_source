import { GetServerSidePropsContext } from "next";
import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { TrendingShare } from "../types/share.type";
import { getShareThumbnailUrl } from "../utils/file.util";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import { fetchShareList } from "../utils/seo.server.util";
import { buildCollectionPage, buildItemList } from "../utils/seo.util";

export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const initialItems = await fetchShareList(apiURL, "recent", 200);
  setPublicCacheHeaders(res, 60, 30);
  return { props: { initialItems } };
}

const NewShares = ({ initialItems }: { initialItems: TrendingShare[] }) => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("seo.custom.new.description");
  const jsonLd = buildCollectionPage({
    name: t("new.custom.title"),
    description,
    path: "/new",
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
        title={t("new.custom.title")}
        description={description}
        canonicalPath="/new"
        jsonLd={jsonLd}
      />
      <TrendingToday
        embedded
        limit={200}
        previewBlur={2}
        initialItems={initialItems}
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
