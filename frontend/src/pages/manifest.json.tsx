import { GetServerSidePropsContext } from "next";
import { fetchConfig } from "../utils/config.server.util";
import { setPublicCacheHeaders } from "../utils/httpCache.util";
import {
  DEFAULT_SITE_DESCRIPTION,
  getConfigValue,
  getSiteName,
} from "../utils/seo.util";

// The PWA manifest is served dynamically so that the name always reflects
// the site name configured on the backend (general.appName, which can be
// overridden with the SITE_NAME environment variable in backend/.env).

const icons = [72, 96, 128, 144, 152, 192, 384, 512].flatMap((size) => [
  {
    src: `img/icons/icon-${size}x${size}.png`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose: "any maskable",
  },
  {
    src: `img/icons/icon-${size}x${size}.webp`,
    sizes: `${size}x${size}`,
    type: "image/webp",
    purpose: "any maskable",
  },
]);

export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config, fallback } = await fetchConfig(apiURL);
  const siteName = getSiteName(config);
  const language = getConfigValue(config, "general.defaultLanguage") || "en-US";

  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  // Do not let a configuration-fallback manifest stick in the CDN for a day.
  const maxAge = fallback ? 60 : 86_400;
  setPublicCacheHeaders(res, maxAge, maxAge);
  res.end(
    JSON.stringify(
      {
        id: "/",
        name: siteName,
        short_name: siteName,
        description: DEFAULT_SITE_DESCRIPTION,
        lang: language,
        theme_color: "#46509e",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [{ name: "files", accept: ["*/*"] }],
          },
        },
        icons,
      },
      null,
      2,
    ),
  );

  return { props: {} };
}

export default function Manifest() {
  return null;
}
