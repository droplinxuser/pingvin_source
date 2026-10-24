import { GetServerSidePropsContext } from "next";
import { fetchConfig } from "../utils/config.server.util";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import { resolveSiteUrl } from "../utils/seo.server.util";

const buildFallbackRobots = (baseUrl: string) => {
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
    "Disallow: /*?",
    "",
  ];
  if (baseUrl) lines.push(`Sitemap: ${baseUrl}/sitemap.xml`, "");
  return lines.join("\n");
};

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config } = await fetchConfig(apiURL);
  let text: string | undefined;

  try {
    const response = await fetch(`${apiURL}/api/system/robots.txt`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) text = await response.text();
  } catch {
    // Fall through to the static rule set when the backend is unavailable.
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  setPublicCacheHeaders(res, 86_400);
  res.end(text ?? buildFallbackRobots(resolveSiteUrl(req, config)));
  return { props: {} };
}

export default function Robots() {
  return null;
}
