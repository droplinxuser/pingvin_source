import { Button, Container, Group, TextInput } from "@mantine/core";
import { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useState } from "react";
import { TbSearch } from "react-icons/tb";
import Meta from "../components/Meta";
import TrendingToday from "../components/share/TrendingToday";
import useTranslate from "../hooks/useTranslate.hook";
import shareService from "../services/share.service";
import { TrendingShare } from "../types/share.type";
import { setNoStoreHeaders } from "../utils/httpCache.util";

export async function getServerSideProps({
  query,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const term = typeof query.q === "string" ? query.q.trim() : "";
  let initialItems: TrendingShare[] | null = [];
  if (term) {
    try {
      const response = await fetch(
        `${apiURL}/api/shares/search?q=${encodeURIComponent(term)}&limit=200`,
        { cache: "no-store", signal: AbortSignal.timeout(2000) },
      );
      initialItems = response.ok
        ? ((await response.json()) as TrendingShare[])
        : null;
    } catch {
      initialItems = null;
    }
  }

  // Search result pages depend on a query string and are never cached by the
  // CDN; this also keeps a failed backend response out of any intermediate.
  setNoStoreHeaders(res);
  return { props: { query: term, initialItems: initialItems ?? [] } };
}

const Search = ({
  query,
  initialItems = [],
}: {
  query: string;
  initialItems?: TrendingShare[];
}) => {
  const t = useTranslate();
  const router = useRouter();
  const [term, setTerm] = useState(query);

  // Keep the input in sync when a search is submitted from the header while
  // this page is already mounted.
  useEffect(() => setTerm(query), [query]);

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
        embedded
        limit={200}
        previewBlur={2}
        initialItems={initialItems}
        loadItems={(limit) => shareService.searchShares(query, limit)}
        showMediaTypeBadge
        fileOnlyLayout="centered"
        title={
          query
            ? t("search.custom.results", { query })
            : t("search.custom.title")
        }
        description={t("search.custom.description")}
        loadingText={t("search.custom.loading")}
        emptyText={
          query ? t("search.custom.empty") : t("search.custom.prompt")
        }
      />
    </>
  );
};

export default Search;
