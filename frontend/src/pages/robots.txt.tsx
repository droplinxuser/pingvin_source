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
    "Allow: /new",
    "Allow: /sitemap.xml",
    "Allow: /api/system/sitemaps/",
    // Share thumbnails are used by og:image; allow their versioned query too.
    "Allow: /api/shares/*/thumbnail*",
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
  const { config, fallback } = await fetchConfig(apiURL);
  let text: string | undefined;

  try {
    const response = await fetch(`${apiURL}/api/system/robots.txt`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const body = (await response.text()).trim();
      if (body) text = body;
    }
  } catch {
    // Fall through to the static rule set when the backend is unavailable.
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  // A fallback generated while the backend (or its sitemap artifact) is down
  // must not be cached for a day with a possibly stale sitemap URL.
  const maxAge = fallback || !text ? 60 : 86_400;
  setPublicCacheHeaders(res, maxAge, maxAge);
  res.end(text ?? buildFallbackRobots(resolveSiteUrl(req, config)));
  return { props: {} };
}

export default function Robots() {
  return null;
}
