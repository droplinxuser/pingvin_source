/** @type {import('next').NextConfig} */
const fs = require("fs");
const path = require("path");
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const { version } = require("./package.json");

// next-pwa serves public/manifest.json as-is, so the PWA manifest is rewritten
// during `next build` with the site name configured in SITE_NAME (see
// frontend/.env.example; update.sh exports it from the backend systemd unit).
const DEFAULT_SITE_NAME = "Pingvin Share";

function updateManifest(siteName) {
  const manifestPath = path.join(process.cwd(), "public", "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const updatedManifest = {
      ...manifest,
      name: siteName,
      short_name: siteName,
    };
    if (JSON.stringify(updatedManifest) !== JSON.stringify(manifest)) {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(updatedManifest, null, 2) + "\n",
      );
    }
  } catch (error) {
    console.warn("[SiteName] Could not update public/manifest.json:", error);
  }
}

const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  runtimeCaching: [
    {
      urlPattern: /^(?!.*\/api(\/|$)).*/,
      handler: "NetworkOnly",
    },
  ],
});

module.exports = (phase) => {
  // Only update the manifest during `next build`, not on `next start` or in
  // development.
  if (phase === PHASE_PRODUCTION_BUILD) {
    const siteName = process.env.SITE_NAME?.trim() || DEFAULT_SITE_NAME;
    console.log(`[SiteName] PWA manifest name resolved to "${siteName}".`);
    updateManifest(siteName);
  }

  return withPWA({
    transpilePackages: ["@uiw/react-md-editor", "@uiw/react-markdown-preview"],
    output: "standalone",
    images: {
      unoptimized: true,
    },
    env: {
      VERSION: version,
    },
  });
};
