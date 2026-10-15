/** @type {import('next').NextConfig} */
const fs = require("fs");
const path = require("path");
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const { version } = require("./package.json");

// next-pwa serves public/manifest.json as-is, so the PWA manifest is rewritten
// during `next build` with the configured site name. Resolution order:
//   1. the SITE_NAME environment variable (frontend/.env or the shell),
//   2. Environment=SITE_NAME=... in the systemd unit below,
//   3. the fallback.
// Next.js loads .env files before this config file is executed.
const DEFAULT_SITE_NAME = "Pingvin Share";
const SERVICE_FILE =
  process.env.PINGVIN_SERVICE_FILE ||
  "/etc/systemd/system/pingvin-back.service";

function resolveSiteName() {
  const fromEnvironment = process.env.SITE_NAME?.trim();
  if (fromEnvironment) return fromEnvironment;

  const unit = fs.existsSync(SERVICE_FILE)
    ? fs.readFileSync(SERVICE_FILE, "utf8")
    : "";
  // Matches Environment=SITE_NAME=... / Environment="SITE_NAME=..."; the last
  // assignment wins, matching systemd behaviour.
  const assignments = [
    ...unit.matchAll(/^\s*Environment=['"]?SITE_NAME=(.*?)['"]?\s*$/gm),
  ];
  const fromServiceFile = assignments.length
    ? assignments[assignments.length - 1][1].replace(/^["']|["']$/g, "")
    : "";

  return fromServiceFile || DEFAULT_SITE_NAME;
}

function updateManifest(siteName) {
  const manifestPath = path.join(process.cwd(), "public", "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const updatedManifest = { ...manifest, name: siteName, short_name: siteName };
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
