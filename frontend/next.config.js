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
  // Navigations are NetworkOnly, so precaching every lazy chunk only costs
  // bandwidth (5 MB+) without enabling offline use. Keep the core bundles and
  // page chunks, and leave replaceable branding to the HTTP cache.
  buildExcludes: [
    /static\/chunks\/(?!pages\/)(?!framework|main|webpack).*/,
    // Next 15 writes this manifest under .next, but the standalone server does
    // not expose it at /_next/. A 404 in the precache list aborts the whole
    // service-worker install, so leave it out of the manifest list.
    /dynamic-css-manifest\.json$/,
  ],
  publicExcludes: [
    "!img/logo*.png",
    "!img/logo*.webp",
    "!img/icons/**/*",
    "!img/og-image.png",
    "!favicon.ico",
  ],
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
// given URL. Logos, favicons and PWA icons can be replaced from the admin UI,
// so they use a shorter TTL when Next serves them directly (the production
// Angie vhost serves public files from disk and applies its own TTL). The
// service worker must be revalidated so new builds are picked up.
const CACHE_RULES = [
  ["/_next/static/:path*", "public, max-age=31536000, immutable"],
  ["/img/:path*", "public, max-age=86400, stale-while-revalidate=604800"],
  ["/favicon.ico", "public, max-age=86400, stale-while-revalidate=604800"],
  ["/sw.js", "no-cache"],
  ["/workbox-:path(.*)", "public, max-age=31536000, immutable"],
];

module.exports = withPWA({
  poweredByHeader: false,
  // The repository root also has a package.json/lockfile, so Next 15 would
  // otherwise trace the workspace from there and emit
  // .next/standalone/frontend/server.js. Pinning the root to the frontend keeps
  // the documented .next/standalone/server.js entrypoint for the systemd unit.
  outputFileTracingRoot: __dirname,
  async redirects() {
    // Short share links are the common email link. Let Next answer them before
    // middleware/SSR instead of rendering a page only to return the same 308.
    return [
      {
        source: "/s/:shareId",
        destination: "/share/:shareId",
        permanent: true,
      },
      // The newest media shares moved to /new-media (the media-only listing);
      // keep the old path working for existing bookmarks and incoming links.
      {
        source: "/new",
        destination: "/new-media",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        // X-Frame-Options and Referrer-Policy are owned by the Angie h5bp
        // include; setting them here as well sends duplicate response headers.
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // This app never needs camera, microphone, location or payment
          // access. Keep third-party ad code from requesting them.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ],
      },
      ...CACHE_RULES.map(([source, value]) => ({
        source,
        headers: cacheHeaders(value),
      })),
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
