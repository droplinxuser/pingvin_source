import { GetServerSidePropsContext } from "next";
import { fetchConfig } from "../utils/config.server.util";

// The PWA manifest is served dynamically so that the name always reflects
// the site name configured on the backend (general.appName, which can be
// overridden with the SITE_NAME environment variable in backend/.env).

const DEFAULT_SITE_NAME = "Pingvin Share";

const icons = [72, 96, 128, 144, 152, 192, 384, 512].map((size) => ({
  src: `img/icons/icon-${size}x${size}.png`,
  sizes: `${size}x${size}`,
  type: "image/png",
  purpose: "any maskable",
}));

export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config } = await fetchConfig(apiURL);
  const siteName =
    config.find((item) => item.key === "general.appName")?.value?.trim() ||
    DEFAULT_SITE_NAME;

  const cache = "public, max-age=86400";
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("CDN-Cache-Control", cache);
  res.setHeader("Cloudflare-CDN-Cache-Control", cache);
  res.end(
    JSON.stringify(
      {
        name: siteName,
        short_name: siteName,
        theme_color: "#46509e",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
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
