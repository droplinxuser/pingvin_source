import { GetServerSidePropsContext } from "next";
import Meta from "../components/Meta";
import ShareList from "../components/share/ShareList";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { TrendingShare } from "../types/share.type";
import { setListingCacheHeaders } from "../utils/httpCache.util";
import { fetchShareList } from "../utils/seo.server.util";
import { buildShareListCollectionPage } from "../utils/seo.util";

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const initialItems = await fetchShareList(apiURL, "recent-files", 200);
  setListingCacheHeaders(
    req,
    res,
    initialItems !== null && initialItems.length > 0,
  );
  return { props: { initialItems } };
}

const NewFiles = ({
  initialItems,
}: {
  initialItems?: TrendingShare[] | null;
}) => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("seo.custom.newFiles.description");
  const jsonLd = buildShareListCollectionPage({
    items: initialItems ?? [],
    name: t("newFiles.custom.title"),
    description,
    path: "/new-files",
    siteName,
    baseUrl,
  });

  return (
    <>
      <Meta
        title={t("newFiles.custom.title")}
        description={description}
        canonicalPath="/new-files"
        jsonLd={jsonLd}
      />
      <ShareList
        limit={200}
        initialItems={initialItems}
        loadItems={shareService.getRecentFiles}
        showDescription={false}
        showFileNames
        testId="recent-files-list"
        title={t("newFiles.custom.title")}
        description={t("newFiles.custom.description")}
        loadingText={t("newFiles.custom.loading")}
        emptyText={t("newFiles.custom.empty")}
      />
    </>
  );
};

export default NewFiles;
