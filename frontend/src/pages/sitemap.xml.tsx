import { GetServerSidePropsContext } from "next";
import { fetchConfig } from "../utils/config.server.util";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import { fetchSitemap, resolveSiteUrl } from "../utils/seo.server.util";
import { absoluteUrl, escapeXml, getConfigValue } from "../utils/seo.util";

const MAX_SITEMAP_URLS = 45_000;

type UrlEntry = { loc: string; lastmod?: string };

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const [{ config }, shares] = await Promise.all([
    fetchConfig(apiURL),
    fetchSitemap(apiURL),
  ]);
  const baseUrl = resolveSiteUrl(req, config);

  const urls: UrlEntry[] = [
    { loc: absoluteUrl("/", baseUrl) },
    { loc: absoluteUrl("/trending", baseUrl) },
  ];

  const legalEnabled = getConfigValue(config, "legal.enabled") === "true";
  const imprintText = getConfigValue(config, "legal.imprintText");
  const imprintUrl = getConfigValue(config, "legal.imprintUrl");
  const privacyText = getConfigValue(config, "legal.privacyPolicyText");
  const privacyUrl = getConfigValue(config, "legal.privacyPolicyUrl");
  if (
    legalEnabled &&
    (imprintText || (imprintUrl && !/^https?:\/\//i.test(imprintUrl)))
  )
    urls.push({ loc: absoluteUrl("/imprint", baseUrl) });
  if (
    legalEnabled &&
    (privacyText || (privacyUrl && !/^https?:\/\//i.test(privacyUrl)))
  )
    urls.push({ loc: absoluteUrl("/privacy", baseUrl) });

  for (const share of shares ?? []) {
    if (urls.length >= MAX_SITEMAP_URLS) break;
    const lastmod = new Date(share.lastModified);
    urls.push({
      loc: absoluteUrl(`/share/${encodeURIComponent(share.id)}`, baseUrl),
      lastmod: Number.isNaN(lastmod.getTime())
        ? undefined
        : lastmod.toISOString(),
    });
  }

  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map(
      ({ loc, lastmod }) =>
        `  <url><loc>${escapeXml(loc)}</loc>${
          lastmod ? `<lastmod>${lastmod}</lastmod>` : ""
        }</url>`,
    ),
    "</urlset>",
  ].join("\n");

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  setPublicCacheHeaders(res, 3_600);
  res.end(body);
  return { props: {} };
}

export default function Sitemap() {
  return null;
}
