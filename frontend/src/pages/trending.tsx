import { GetServerSideProps } from "next";
import Meta from "../components/Meta";
import TrendingCountries from "../components/share/TrendingCountries";
import TrendingToday from "../components/share/TrendingToday";
import useConfig from "../hooks/config.hook";
import useTranslate from "../hooks/useTranslate.hook";
import { TrendingCountry, TrendingShare } from "../types/share.type";
import {
  fetchTrending,
  fetchTrendingCountries,
} from "../utils/trending.server.util";
import { absoluteUrl, normalizeBaseUrl } from "../utils/seo.util";

export const getServerSideProps: GetServerSideProps = async () => {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const [trending, countries] = await Promise.all([
    fetchTrending(apiURL, 48),
    fetchTrendingCountries(apiURL),
  ]);

  return { props: { trending, countries } };
};

const Trending = ({
  trending,
  countries,
}: {
  trending?: TrendingShare[];
  countries?: TrendingCountry[];
}) => {
  const t = useTranslate();
  const config = useConfig();
  const siteName =
    (config.get("general.appName") as string)?.trim() || "Pingvin Share";
  const baseUrl = normalizeBaseUrl(config.get("general.appUrl") as string);
  const items = trending ?? [];
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
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: Math.min(items.length, 24),
      itemListElement: items.slice(0, 24).map((item, position) => ({
        "@type": "ListItem",
        position: position + 1,
        name: item.name || item.id,
        url: absoluteUrl(`/share/${encodeURIComponent(item.id)}`, baseUrl),
      })),
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
      <TrendingToday initialItems={trending} embedded limit={48}>
        <TrendingCountries countries={countries} />
      </TrendingToday>
    </>
  );
};

export default Trending;
