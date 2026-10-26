import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { buildCollectionPage } from "../utils/seo.util";

const NewShares = () => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const description = t("seo.custom.new.description");
  const jsonLd = buildCollectionPage({
    name: t("new.custom.title"),
    description,
    path: "/new",
    siteName,
    baseUrl,
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
