import { GetServerSidePropsContext } from "next";
import { fetchConfig } from "../utils/config.server.util";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import { resolveSiteUrl } from "../utils/seo.server.util";

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config } = await fetchConfig(apiURL);
  const baseUrl = resolveSiteUrl(req, config);

  const lines = [
    "User-agent: *",
    "Allow: /$",
    "Allow: /share/",
    "Allow: /trending",
    "Disallow: /admin",
    "Disallow: /account",
    "Disallow: /auth",
    "Disallow: /upload",
    "Disallow: /error",
    "Disallow: /api",
    "Disallow: /s/",
    "Disallow: /share/*/edit",
    // Query strings create duplicate share/auth variants and carry recipient
    // tokens. Canonical URLs never contain a query string.
    "Disallow: /*?",
    "",
  ];
  if (baseUrl) lines.push(`Sitemap: ${baseUrl}/sitemap.xml`, "");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  setPublicCacheHeaders(res, 86_400);
  res.end(lines.join("\n"));
  return { props: {} };
}

export default function Robots() {
  return null;
}
