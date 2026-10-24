import { GetServerSideProps } from "next";
import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useTranslate from "../hooks/useTranslate.hook";
import { TrendingShare } from "../types/share.type";

export const getServerSideProps: GetServerSideProps = async () => {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const trending = await fetch(`${apiURL}/api/shares/trending?limit=48`, {
    cache: "no-store",
    signal: AbortSignal.timeout(1500),
  })
    .then((response) =>
      response.ok ? (response.json() as Promise<TrendingShare[]>) : undefined,
    )
    .catch(() => undefined);

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
