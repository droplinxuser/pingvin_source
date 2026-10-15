/** @type {import('next').NextConfig} */
const fs = require("fs");
const path = require("path");
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const { version } = require("./package.json");

// next-pwa serves public/manifest.json as-is, so the PWA manifest is rewritten
// during `next build` with the configured site name (see frontend/.env.example).
// Resolution order: the SITE_NAME env var (Next.js loads .env automatically),
// Environment=SITE_NAME=... in the backend systemd unit, then the fallback.
const DEFAULT_SITE_NAME = "Pingvin Share";

function resolveSiteName() {
  const fromEnvironment = process.env.SITE_NAME?.trim();
  if (fromEnvironment) return fromEnvironment;

  const serviceFile =
    process.env.PINGVIN_SERVICE_FILE ||
    "/etc/systemd/system/pingvin-back.service";
  const unit = fs.existsSync(serviceFile)
    ? fs.readFileSync(serviceFile, "utf8")
    : "";
  // The last assignment wins, matching systemd behaviour.
  const assignments = [
    ...unit.matchAll(/^\s*Environment=['"]?SITE_NAME=(.*?)['"]?\s*$/gm),
  ];
  const fromServiceFile = assignments.at(-1)?.[1].replace(/^["']|["']$/g, "");

  return fromServiceFile || DEFAULT_SITE_NAME;
}

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
    const siteName = resolveSiteName();
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
