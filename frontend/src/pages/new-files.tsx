import { GetServerSidePropsContext } from "next";
import Meta from "../components/Meta";
import RecentFilesList from "../components/share/RecentFilesList";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { TrendingShare } from "../types/share.type";
import { getShareThumbnailUrl } from "../utils/file.util";
import {
  setNoStoreHeaders,
  setPublicCacheHeaders,
} from "../utils/httpCache.util";
import { fetchShareList } from "../utils/seo.server.util";
import { buildCollectionPage, buildItemList } from "../utils/seo.util";

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const initialItems = await fetchShareList(apiURL, "recent-files", 200);
  if (req.url?.startsWith("/_next/data/") || initialItems === null)
    setNoStoreHeaders(res);
  else setPublicCacheHeaders(res, 60, 30);
  return { props: { initialItems: initialItems ?? [] } };
}

const NewFiles = ({
  initialItems = [],
}: {
  initialItems?: TrendingShare[];
}) => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("seo.custom.newFiles.description");
  const jsonLd = buildCollectionPage({
    name: t("newFiles.custom.title"),
    description,
    path: "/new-files",
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
        title={t("newFiles.custom.title")}
        description={description}
        canonicalPath="/new-files"
        jsonLd={jsonLd}
      />
      <RecentFilesList
        limit={200}
        initialItems={initialItems}
        loadItems={shareService.getRecentFiles}
        title={t("newFiles.custom.title")}
        description={t("newFiles.custom.description")}
        loadingText={t("newFiles.custom.loading")}
        emptyText={t("newFiles.custom.empty")}
      />
    </>
  );
};

export default NewFiles;
