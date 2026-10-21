/** @type {import('next').NextConfig} */
const { version } = require("./package.json");

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
  },
});
