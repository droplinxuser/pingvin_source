import axios from "axios";
import { GetServerSidePropsContext } from "next";

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

const buildManifest = (siteName: string) => ({
  name: siteName,
  short_name: siteName,
  theme_color: "#46509e",
  background_color: "#ffffff",
  display: "standalone",
  orientation: "portrait",
  scope: "/",
  start_url: "/",
  icons,
});

export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";

  let siteName = DEFAULT_SITE_NAME;
  try {
    const response = await axios.get(`${apiURL}/api/configs`, {
      timeout: 2000,
    });
    siteName =
      response.data?.find(
        (config: { key: string; value: string }) =>
          config.key === "general.appName",
      )?.value?.trim() || DEFAULT_SITE_NAME;
  } catch {
    // Backend unreachable: fall back to the default site name
  }

  const cache = "public, max-age=86400";
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("CDN-Cache-Control", cache);
  res.setHeader("Cloudflare-CDN-Cache-Control", cache);
  res.write(JSON.stringify(buildManifest(siteName), null, 2));
  res.end();

  return { props: {} };
}

export default function Manifest() {
  return null;
}
