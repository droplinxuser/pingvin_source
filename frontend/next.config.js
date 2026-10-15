/** @type {import('next').NextConfig} */
const fs = require("fs");
const path = require("path");
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const { version } = require("./package.json");

// Load .env files (e.g. SITE_NAME) so they can be used at build time.
// Files already present in process.env are never overwritten.
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

// Safe fallback used when no site name is configured anywhere (e.g. local
// Windows development builds without a .env file or environment variable).
const DEFAULT_SITE_NAME = "Pingvin Share";

// systemd unit that defines the production SITE_NAME. Override the location
// with the PINGVIN_SERVICE_FILE environment variable when the unit lives
// somewhere else (e.g. for local testing).
const SERVICE_FILE =
  process.env.PINGVIN_SERVICE_FILE ||
  "/etc/systemd/system/pingvin-back.service";

// Reads `Environment=SITE_NAME=...` from a systemd unit file. Returns
// undefined when the file does not exist or does not define SITE_NAME.
function readSiteNameFromServiceFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }

  let siteName;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*Environment\s*=\s*(.*)$/);
    if (!match) continue;

    let assignment = match[1].trim();
    // Strip outer quotes: Environment="SITE_NAME=My Site"
    if (/^".*"$/.test(assignment) || /^'.*'$/.test(assignment)) {
      assignment = assignment.slice(1, -1);
    }

    const separator = assignment.indexOf("=");
    if (separator === -1) continue;

    const key = assignment.slice(0, separator).trim();
    let value = assignment.slice(separator + 1).trim();
    // Strip value quotes: Environment=SITE_NAME="My Site"
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
      value = value.slice(1, -1);
    }

    // Later assignments win, matching systemd behaviour.
    if (key === "SITE_NAME" && value) siteName = value;
  }
  return siteName;
}

// Resolves the site name, in order of precedence, from:
//   1. the SITE_NAME environment variable (shell or frontend/.env),
//   2. a systemd unit file that sets Environment=SITE_NAME=... (the
//      production server keeps this in /etc/systemd/system/pingvin-back.service),
//   3. the DEFAULT_SITE_NAME fallback.
function resolveSiteName() {
  const fromEnvironment = process.env.SITE_NAME?.trim();
  if (fromEnvironment) {
    return { name: fromEnvironment, source: "SITE_NAME environment variable" };
  }

  const fromServiceFile = readSiteNameFromServiceFile(SERVICE_FILE);
  if (fromServiceFile) {
    return { name: fromServiceFile, source: SERVICE_FILE };
  }

  return { name: DEFAULT_SITE_NAME, source: "built-in fallback" };
}

// next-pwa serves public/manifest.json as-is, so the manifest is regenerated
// during `next build` to reflect the configured site name. The file is only
// written when the name actually differs, keeping the working tree clean.
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
    console.warn(
      "[SiteName] Could not update public/manifest.json, using the default manifest:",
      error,
    );
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
  // Only rewrite the manifest during `next build`. Loading this config on
  // server start (`next start`) or in development must not modify the file.
  if (phase === PHASE_PRODUCTION_BUILD) {
    const { name, source } = resolveSiteName();
    console.log(`[SiteName] PWA manifest name resolved to "${name}" (${source}).`);
    updateManifest(name);
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
