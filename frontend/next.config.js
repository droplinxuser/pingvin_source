/** @type {import('next').NextConfig} */
const fs = require("fs");
const path = require("path");
const { version } = require("./package.json");

// Load .env files (e.g. SITE_NAME) so they can be used at build time.
// Files already present in process.env are never overwritten.
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

// The site name shown in the PWA manifest. Defaults to the "SiteName"
// placeholder; set SITE_NAME in the .env file on the server to override it
// (e.g. SITE_NAME=MySite).
const siteName = process.env.SITE_NAME?.trim() || "SiteName";

// next-pwa serves public/manifest.json as-is, so the manifest is regenerated
// here at build time to reflect the configured site name. The file is only
// written when the name actually differs, keeping the working tree clean.
const manifestPath = path.join(process.cwd(), "public", "manifest.json");
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const updatedManifest = { ...manifest, name: siteName, short_name: siteName };
  if (JSON.stringify(updatedManifest) !== JSON.stringify(manifest)) {
    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2));
  }
} catch (error) {
  console.warn(
    "[SiteName] Could not update public/manifest.json, using the default manifest:",
    error,
  );
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

module.exports = withPWA({
  transpilePackages: ["@uiw/react-md-editor", "@uiw/react-markdown-preview"],
  output: "standalone",
  images: {
    unoptimized: true,
  },
  env: {
    VERSION: version,
  },
});
