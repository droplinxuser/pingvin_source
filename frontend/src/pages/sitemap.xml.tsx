import { GetServerSidePropsContext } from "next";
import { fetchConfig } from "../utils/config.server.util";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import { resolveSiteUrl } from "../utils/seo.server.util";
import { absoluteUrl, escapeXml, getConfigValue } from "../utils/seo.util";

const buildFallbackSitemap = (
  baseUrl: string,
  config: Parameters<typeof getConfigValue>[0],
) => {
  const urls = [
    // The home page 302s to /upload when it is disabled; only list it when it
    // is actually served so the fallback sitemap never advertises a redirect.
    ...(getConfigValue(config, "general.showHomePage") !== "false"
      ? [absoluteUrl("/", baseUrl)]
      : []),
    absoluteUrl("/trending", baseUrl),
    absoluteUrl("/new-media", baseUrl),
    absoluteUrl("/new-files", baseUrl),
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
    urls.push(absoluteUrl("/imprint", baseUrl));
  if (
    legalEnabled &&
    (privacyText || (privacyUrl && !/^https?:\/\//i.test(privacyUrl)))
  )
    urls.push(absoluteUrl("/privacy", baseUrl));

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`),
    `</urlset>`,
  ].join("\n");
};

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config, fallback } = await fetchConfig(apiURL);
  let xml: string | undefined;

  try {
    const response = await fetch(`${apiURL}/api/system/sitemap.xml`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const body = (await response.text()).trim();
      if (body) xml = body;
    }
  } catch {
    // Fall through to the static route list when the backend is unavailable.
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  // Do not cache the small fallback sitemap when the backend (or its sitemap
  // artifact) was unavailable; retry soon after it recovers. Config fallback
  // can happen independently of a sitemap fetch failure, so check both.
  const maxAge = fallback || !xml ? 60 : 3_600;
  setPublicCacheHeaders(res, maxAge, maxAge);
  res.end(xml ?? buildFallbackSitemap(resolveSiteUrl(req, config), config));
  return { props: {} };
}

export default function Sitemap() {
  return null;
}
