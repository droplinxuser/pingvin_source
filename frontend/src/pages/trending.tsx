import { GetServerSideProps } from "next";
import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useTranslate from "../hooks/useTranslate.hook";
import { TrendingShare } from "../types/share.type";
import { fetchTrending } from "../utils/trending.server.util";

export const getServerSideProps: GetServerSideProps = async () => {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const trending = await fetchTrending(apiURL, 48);

  return { props: { trending: trending ?? [] } };
};

const Trending = ({ trending }: { trending?: TrendingShare[] }) => {
  const t = useTranslate();

  return (
    <>
      <Meta
        title={t("trending.custom.title")}
        description={t("trending.custom.description")}
      />
      <TrendingToday initialItems={trending} embedded limit={48} />
    </>
  );
};

export default Trending;
