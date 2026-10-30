import { Button, Container, Group, TextInput } from "@mantine/core";
import { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { TbSearch } from "react-icons/tb";
import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { setNoStoreHeaders } from "../utils/httpCache.util";

export async function getServerSideProps({
  query,
  res,
}: GetServerSidePropsContext) {
  const term = typeof query.q === "string" ? query.q.trim() : "";

  // Results are query-dependent and the page is noindex, so there is nothing
  // for crawlers to gain from a server-side fetch. Keeping it off the Next
  // server also stops share-page traffic and search traffic from competing for
  // the backend's shared per-IP request bucket. TrendingToday performs the
  // lookup in the browser (and skips the API entirely for an empty query).
  setNoStoreHeaders(res);
  return { props: { query: term } };
}

const Search = ({ query }: { query: string }) => {
  const t = useTranslate();
  const router = useRouter();
  const [term, setTerm] = useState(query);

  // Keep the input in sync when a search is submitted from the header while
  // this page is already mounted.
  useEffect(() => setTerm(query), [query]);

  // The listing widget keeps this callback in an effect dependency list. An
  // inline arrow would get a new identity on every render, so an empty result
  // set would keep refetching (and a keystroke would fire a request per
  // character).
  const loadSearchItems = useCallback(
    (limit: number) => shareService.searchShares(query, limit),
    [query],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    if (!value || value === query) return;
    router.push({ pathname: "/search", query: { q: value } });
  };

  return (
    <>
      <Meta
        title={t("search.custom.title")}
        description={t("search.custom.description")}
        canonicalPath="/search"
        noindex
      />
      <Container>
        <form onSubmit={submit} role="search">
          <Group mt="xl" mb="md" noWrap>
            <TextInput
              value={term}
              onChange={(event) => setTerm(event.currentTarget.value)}
              placeholder={t("search.custom.placeholder")}
              icon={<TbSearch size={18} aria-hidden />}
              aria-label={t("search.custom.placeholder")}
              sx={{ flex: 1 }}
            />
            <Button type="submit" radius="xl">
              {t("search.custom.action")}
            </Button>
          </Group>
        </form>
      </Container>
      <TrendingToday
        key={query}
        embedded
        limit={200}
        previewBlur={2}
        loadItems={loadSearchItems}
        showMediaTypeBadge
        fileOnlyLayout="centered"
        title={
          query
            ? t("search.custom.results", { query })
            : t("search.custom.title")
        }
        description={t("search.custom.description")}
        loadingText={t("search.custom.loading")}
        emptyText={query ? t("search.custom.empty") : t("search.custom.prompt")}
      />
    </>
  );
};

export default Search;
