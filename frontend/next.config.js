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

module.exports = withPWA({
  async headers() {
    return [
      {
        // Hashed build output never changes for a given URL.
        source: "/_next/static/:path*",
        headers: cacheHeaders("public, max-age=31536000, immutable"),
      },
      {
        // Logos, favicons and PWA icons can be replaced from the admin UI.
        source: "/img/:path*",
        headers: cacheHeaders("public, max-age=2592000"),
      },
      {
        source: "/favicon.ico",
        headers: cacheHeaders("public, max-age=2592000"),
      },
      {
        // The service worker must be revalidated so new builds are picked up.
        source: "/sw.js",
        headers: cacheHeaders("no-cache"),
      },
      {
        // Workbox bundles are content-hashed.
        source: "/workbox-:path*",
        headers: cacheHeaders("public, max-age=31536000, immutable"),
      },
    ];
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
