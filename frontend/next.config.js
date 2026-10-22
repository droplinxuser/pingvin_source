/** @type {import('next').NextConfig} */
const { execSync } = require("child_process");
const { version } = require("./package.json");

let commitHash = process.env.COMMIT_HASH || "";
if (!commitHash) {
  try {
    commitHash = execSync("git rev-parse --short=8 HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Building outside a git checkout (e.g. a source archive).
  }
}

const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // Registered manually in _app with the build hash in the URL so a cached
  // /sw.js cannot keep an old service worker alive across deployments.
  register: false,
  reloadOnOnline: false,
  runtimeCaching: [
    {
      urlPattern: /^(?!.*\/api(\/|$)).*/,
      handler: "NetworkOnly",
    },
  ],
});

const cacheHeaders = (value) => [
  { key: "Cache-Control", value },
  { key: "CDN-Cache-Control", value },
  { key: "Cloudflare-CDN-Cache-Control", value },
];

// Hashed build output and content-hashed Workbox bundles never change for a
// given URL. Logos, favicons and PWA icons can be replaced from the admin UI.
// The service worker must be revalidated so new builds are picked up.
const CACHE_RULES = [
  ["/_next/static/:path*", "public, max-age=31536000, immutable"],
  ["/img/:path*", "public, max-age=2592000"],
  ["/favicon.ico", "public, max-age=2592000"],
  ["/sw.js", "no-cache"],
  ["/workbox-:path*", "public, max-age=31536000, immutable"],
];

module.exports = withPWA({
  async headers() {
    return CACHE_RULES.map(([source, value]) => ({
      source,
      headers: cacheHeaders(value),
    }));
  },
  transpilePackages: ["@uiw/react-md-editor", "@uiw/react-markdown-preview"],
  output: "standalone",
  images: {
    unoptimized: true,
  },
  env: {
    VERSION: version,
    COMMIT_HASH: commitHash,
  },
});
