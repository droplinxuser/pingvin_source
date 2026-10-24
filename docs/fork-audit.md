# Fork maintenance notes

`droplinxuser/pingvin_source` is a lightly customized fork of
`smp46/pingvin-share-x`. Keep custom code out of upstream files where possible
so `git merge upstream/main` stays small.

## Custom areas

| Area | Main files |
|---|---|
| Environment loading / production config | `backend/src/constants.ts`, `backend/src/config/config.service.ts`, `backend/src/main.ts`, `backend/.env.example` |
| Rolling 100-day expiration | `backend/src/share/share.util.ts` (`SHARE_EXPIRATION`), migrations `20261016000000` / `20261016000001`, share create/edit modals |
| Admin pagination, search and sorting | `backend/src/share/share.service.ts`, `backend/src/user/user.service.ts`, `frontend/src/pages/admin/*`, `frontend/src/components/core/SortIcon.tsx` |
| Share reports | `backend/src/share/dto/reportShare.dto.ts`, `backend/src/email/email.service.ts`, `frontend/src/components/share/showReportShareModal.tsx` |
| Uploader metadata / visitors | `backend/src/utils/uploaderInfo.util.ts`, `ShareDTO.uploaderInfo`, `frontend/src/components/share/UploaderInfoBadges.tsx`, `ShareStats.tsx`; view counts stay in `Share.views` |
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` (up to 30 supported image/video thumbnails at 250px for any file size, opening `FilePreview.tsx` in the full-size modal) |
| Individual downloads / legacy ZIP | `frontend/src/components/share/DownloadAllButton.tsx` (confirmation + sequential per-file downloads), `frontend/src/services/share.service.ts` (anchor-based downloads), `backend/src/share/share.service.ts` (no automatic archive creation); existing `archive.zip` files remain served by the legacy API. The share file count uses `share.custom.fileCount` without the old ZIP note. |
| Trending today | `backend/src/cache/trending.service.ts`, `GET /api/shares/trending?limit=48`, `frontend/src/components/share/TrendingToday.tsx`, `frontend/src/pages/trending.tsx`, `frontend/src/pages/_app.tsx` |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts` (shared `Cache-Control`, `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, public-file `ETag`), `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts` (query-free anonymous page shells), `frontend/next.config.js` |
| Per-IP+User-Agent rate limiting | `backend/src/utils/visitorIdentity.util.ts`, `backend/src/cache/valkeyThrottler.storage.ts`, `backend/src/cache/throttler.config.ts`, `backend/src/main.ts` |
| Valkey/Redis cache | `backend/src/utils/cache.util.ts`, `backend/src/share/shareState.service.ts`, `backend/src/cache/cache.module.ts`, `backend/src/cache/valkey.service.ts` |
| VirusTotal background scanning | `backend/src/virustotal/*` (worker, file-backed audit, admin controller), `backend/src/share/share.service.ts` (completion hook), `backend/src/share/share.module.ts`, `backend/src/clamscan/clamscan.service.ts` (shared malicious-share removal), `frontend/src/pages/admin/virustotal.tsx`, `backend/.env.example` |
| Site stats and footer | `backend/src/system/system.service.ts`, `backend/src/cache/metrics.service.ts`, `frontend/src/components/footer/Footer.tsx`; `POST /api/system/pageview` |
| Valkey metrics and error logs | `backend/src/cache/valkeyMetrics.util.ts`, `backend/src/logs/*`, `backend/src/system/system.controller.ts` (`GET /api/system/valkey`), `frontend/src/components/admin/ValkeyMetricsCard.tsx`, `frontend/src/pages/admin/logs.tsx`, `frontend/src/services/log.service.ts`, `frontend/src/utils/errorReporter.util.ts` |
| Home copy and ads | `frontend/src/pages/index.tsx` (upstream layout), `home.custom.*` keys in `en-US.ts`, `frontend/src/components/Ads.tsx` |
| Fork branding / deployment | `frontend/public/img/**`, `frontend/public/favicon.ico`, `frontend/src/pages/manifest.json.tsx`, `pingvin-*.service`, `update.sh` |
| SEO / crawlers | `frontend/src/components/Meta.tsx`, `SiteStructuredData.tsx`, `frontend/src/pages/robots.txt.tsx`, `frontend/src/pages/sitemap.xml.tsx`, `frontend/src/utils/seo.util.ts`, `frontend/src/utils/seo.server.util.ts`, `backend/src/share/share.service.ts` (`getSeo`), `backend/src/system/system.service.ts` (`getRobotsTxt`, `getSitemapXml`) |
| WebP / image pipeline | `backend/src/file/file.service.ts` (private preview cache), `backend/src/file/file.controller.ts` (`webp=300`), `backend/src/config/logo.service.ts`, `frontend/src/utils/file.util.ts`, `frontend/src/components/Logo.tsx`, `frontend/public/img/*.webp`, `og-image.png` |

Fork-only UI strings live in `frontend/src/i18n/translations/en-US.ts`; every
other locale falls back to English through `frontend/src/utils/i18n.util.ts`,
so translations do not need a fork-specific edit on each upstream merge. New
fork strings must use new `*.custom.*` keys: reusing an upstream key would make
other languages show the upstream copy instead of the English fallback.

## Merge checklist

1. `git fetch upstream && git merge upstream/main` on a branch.
2. Resolve conflicts mainly in `share.service.ts`, the share create/edit modals
   and `createShare.dto.ts` / `createReverseShare.dto.ts`.
3. Re-check the production settings below after any config seed changes.
4. Run:
   - backend: `npm ci && npm run build && npm run test:unit`
   - frontend: `npm ci && npm run build`
   - lint: `npm run lint` in both packages (backend warnings are upstream-only)
5. Smoke-test locally: home page, sign-in, upload, share page, admin
   shares/users (search, sort, pagination), the `/admin/virustotal`
   dashboard (status, API counts, detections, uploader identity, filter and
   the file-backed state), the `/admin` Valkey metrics card and `/admin/logs`
   (copy, pagination, browser error reporting), missing share (404), trending
   widget on `/share/*`
   and 404 pages (no widget on home, upload or other pages), the clickable
   widget title and full `/trending` page with up to 48 shares, file download
   headers, report modal, footer page-view/top-country metrics, and the dynamic
   `/manifest.json`. Repeat once with Valkey stopped to confirm the fallbacks
   (the trending widget is hidden without Valkey).

## Production settings

- `security.allowRegistration=false`
- `oauth.allowRegistration=true`
- `oauth.disablePassword=false`
- `share.maxExpiration` / `share.defaultExpiration` are intentionally removed
  from the seed and the share/reverse-share create/update DTOs; expiration is
  rolling and automatic.
- Report notifications use `REPORT_EMAIL` from `backend/.env`, falling back to
  the configured SMTP sender.
- `backend/.env` is authoritative for the backend and systemd unit. Keep the
  live database URL exactly:
  `DATABASE_URL="file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1"`
- `DATA_DIRECTORY="/var/www/pingvin_data"`; uploader/visitor metadata is stored
  per share at `uploads/shares/<shareId>/uploader.json` with mode `600`. View
  counts live in `Share.views` and are updated directly in SQLite. Visitor
  writes are batched for one second per share: the response still includes the
  new visitor immediately, while a burst of views produces a single atomic
  file write (pending entries are flushed on shutdown).
- Global rate limiting is 90 requests per 60 seconds per client, identified by
  client IP + browser `User-Agent`, blocking for 60 seconds after the limit.
  Configure it with `VISITOR_RATE_LIMIT`, `VISITOR_RATE_TTL_MS` and
  `VISITOR_RATE_BLOCK_MS`. No visitor cookie is issued; legacy
  `pingvin_visitor` cookies are ignored and expire naturally. The throttler
  hashes `IP + User-Agent` with SHA-256 before using it as a key, so raw
  identifiers are not stored. The existing per-route/per-IP `THROTTLE_LIMIT`
  limiter remains in place. When `CACHE_REDIS_ENABLED=true`, both limiter
  buckets are stored atomically in Valkey (shared across instances/restarts);
  if Valkey is unavailable they fall back to the in-memory store. `/api/configs`,
  `GET /api/system/stats`, `GET /api/users/me` (called by SSR), share `HEAD`
  checks and every upload request (init, chunk, complete, abort) skip the
  visitor bucket so SSR and large uploads keep working. File GETs are
  still cache-friendly because the response never needs a visitor cookie.
- Valkey/Redis is optional but recommended: set `CACHE_REDIS_ENABLED=true` and
  `CACHE_REDIS_URL=redis://127.0.0.1:6379` in `backend/.env` (`update.sh`
  enables both automatically when a local `valkey-server` is active). Share-page
  data and guard data are cached for 30s each. A data-cache miss also resets
  the rolling expiration to 100 days. Share view counts are written
  directly to SQLite; shares without a view limit use a single atomic update
  instead of a transaction. Visitor metadata is coalesced into one
  `uploader.json` write per second and per share, and pending entries are
  flushed on shutdown. The footer's base counters use a 60-second in-process
  cache and do not add a Valkey key.
- VirusTotal scanning is optional: `VIRUSTOTAL_API_KEY` in `backend/.env`
  enables it. The optional `VIRUSTOTAL_API_URL` exists only for a local stub or
  proxy. On completion, only non-media/plain-text files are queued; raster
  images, audio, video and plain structured text are skipped while SVG is
  scanned. The queue is a 1000-job Valkey list
  (`pingvin:virustotal:queue`, process-memory fallback) and every API step
  (hash lookup, upload, analysis poll) waits for a
  `pingvin:virustotal:request` lock with a 173-second TTL, so at most 500
  requests can start in any 24-hour window (the free-tier daily cap) while the
  shared Valkey lock is available, even across restarts or instances.
  Without Valkey the same spacing is enforced per process. Files are hashed
  locally and looked up by SHA-256 first; they are uploaded only when unknown
  and at most 32 MiB.
  Terminal verdicts are cached as one `pingvin:virustotal:verdict:<sha256>` key
  for seven days. HTTP 429 sets a cooldown key, 401/403 pauses scanning until
  the backend restarts, and 5xx/network failures retry up to three times. A
  malicious VirusTotal verdict removes only the offending file and keeps clean
  files online. If no files remain, the share gets a `removedReason` and
  returns 404; otherwise its stale ZIP is deleted and `isZipReady` is reset.
  No replacement archive is built because automatic ZIP generation is disabled.
  ClamAV continues to remove the whole share. No scan state is written to SQLite.
  Operational history is file-backed at
  `DATA_DIRECTORY/virustotal/state.json` (mode `600`): the latest 200 events,
  48 hours of API-call timestamps and 30 days of daily counters. The
  administrator page `/admin/virustotal` (API `GET /api/admin/virustotal`,
  admin-only, auto-refreshes every 15s) shows scanner/queue/cooldown status,
  API calls for the last hour/today/24h, scan and detection counters, and
  recent events. Events record queued/uploaded/clean/suspicious/malicious
  results, errors, 429 cooldowns and 401/403 pauses. A malicious event captures
  the share creator, the reverse-share owner and the uploader metadata before
  the files are deleted. This file is included in the data-directory backup;
  no SQLite table or migration is used.
- Admin observability is Valkey-first and adds no SQLite tables:
  - The `/admin` dashboard includes a Valkey metrics card. It reads one
    `INFO` response through the shared `ValkeyService` connection and shows
    used/peak memory, total keys (sum of `dbN` keys), cumulative hit ratio
    (`keyspace_hits` / `keyspace_misses`), connected clients, uptime and the
    server version. The admin-only `GET /api/system/valkey` endpoint is
    `no-store`; when Valkey is disabled it returns `configured=false`, and when
    unreachable it returns `configured=true, connected=false` so the UI can
    explain the in-process fallback.
  - `/admin/logs` (`GET /api/admin/logs?source=backend|frontend&page=1&pageSize=20`,
    admin-only) shows the newest 100 entries per source with client-side
    pagination and a one-click copy button. Entries are stored in one Valkey
    list per source (`pingvin:errorlogs:backend` and
    `pingvin:errorlogs:frontend`) with `LPUSH`/`LTRIM`/`EXPIRE` in a single
    `MULTI`; each list has a 7-day TTL and a hard 100-entry cap. No SQLite
    writes or extra keys are made.
  - Backend entries come from a `ConsoleLogger` subclass installed with
    `app.useLogger`, so normal console/systemd output is unchanged while Nest
    `error`/`fatal` logs also go to the store. Browser entries are posted to
    public `POST /api/logs/client` by a small global reporter in `_app`
    (`window.onerror` and `unhandledrejection`); the reporter stores only the
    route path (never the origin or query string, which can carry recipient
    tokens), truncates fields, deduplicates repeats
    for 60s on the server and 15s in the browser, ignores the known third-party
    ad `video.play()`/`NotAllowedError` autoplay rejection, and skips the
    visitor rate bucket so an error loop cannot lock a user out of normal
    pages. If Valkey is
    unavailable both sources fall back to a process-memory buffer (visible
    while the outage lasts; a restart clears it); `storage` in the API response
    tells the UI which backend was used. Browser-side Next.js server errors are
    not captured; the Frontend tab documents that it reports browser uncaught
    errors.
- "Trending today" is stored entirely in Valkey. A public share `GET` records
  the share's total view count as its score in a per-day sorted set
  (`pingvin:trending:views:<day>`, 8-day TTL) and writes
  `{ id, name, previewFileId, previewKind, createdAt }` to one per-share key
  (`pingvin:trending:meta:<shareId>`, 8-day TTL) in the same `MULTI`. The
  metadata is written once (`NX`), and an `EXPIRE` keeps an actively viewed
  share alive without rewriting the JSON on every view; the view badge comes
  from the sorted-set score. One metadata entry per share replaces the old
  per-day copies. Shares older than seven days and shares without an
  image/video are skipped before writing. `GET /api/shares/trending` unions
  the seven daily sets with `AGGREGATE MAX`, reads every candidate's metadata
  with a single `MGET`, drops entries without current metadata or older than
  seven days, and returns the top twelve ordered by total views without any
  SQLite query.
  `?limit=48` returns the full list for the public `/trending` page; other
  values are clamped to 48. The result is cached in-process for 30 seconds and
  is edge-cacheable for 60 seconds. The frontend also caches the public list
  for 30 seconds on the server (`trending.server.util.ts`, used by `_app` and
  `/trending`) and in the browser service, so client navigation does not repeat
  the request. Editing, expiring or deleting a share (including removing its
  files or reverse-share parent) deletes its metadata immediately. If Valkey
  is unavailable the endpoint returns an empty list and the widget is hidden.
- The footer posts to `POST /api/system/pageview` on every rendered page. The
  endpoint increments a per-hour Valkey hash atomically (one total field plus
  one field per country), expires each hourly bucket after 25 hours and reads
  the last 24 hours of page views plus the top eight countries (four columns
  per row on desktop). The aggregate is
  cached in-process for 10s so a page view costs one increment instead of 24
  hash reads. Only the 24 hourly hashes are stored; no per-visitor sets are
  kept. The POST response is never cached. `GET /api/system/stats` remains a
  read-only fallback and is edge-cacheable for 60s; its user/share/file/storage
  totals are fetched in one SQL query and cached in-process for 60s.
- `GET /api/configs` is edge-cacheable for 30s and the server-side
  `fetchConfig` helper keeps a 30s in-process copy (5s for bundled defaults),
  so middleware and SSR do not call the backend on every page.
  The bundled fallback config includes the upload/share keys used during SSR
  (`share.chunkSize`, `share.maxSize`, `share.shareIdLength`,
  `share.autoOpenShareModal`, email-recipient flags, retention,
  `appearance.uploadProgressStyle`, password-policy settings and
  `oauth.disablePassword`), so an API-config timeout no longer crashes
  `/upload` with `Config variable share.chunkSize not found`. Anonymous HTML
  shells for `/`, `/trending`, `/share/*`, `/imprint` and `/privacy` are
  edge-cacheable for
  60s with stale-while-revalidate only when the URL has no query string, the
  language is the default and the theme is unset or light (the light shell is
  identical to the default); authenticated, non-default-language, `?lang=` and
  other query variants (including `?recipient=`) are `no-store` at the origin.
  These public routes never put account data in `__NEXT_DATA__`; `_app`
  restores the signed-in user client-side, so an edge cache hit cannot expose
  another visitor's account. Public files are cached for a day with an `ETag`;
  protected files are `private`. Existing legacy ZIP archives are served as-is
  with a 60-second edge TTL (and `no-store` when protected) instead of the
  immutable single-file headers; no new archives are generated automatically.
- "Download all" downloads each file individually instead of building a ZIP.
  The button is shown immediately for multi-file shares, asks for confirmation,
  and warns that the browser may request permission to allow multiple
  downloads. Each file is fetched through a hidden same-origin anchor with a
  short gap so Chrome/Firefox can show their multiple-download prompt; a short
  settle delay after confirmation prevents the first click being lost while the
  modal closes. Every anchor sets the explicit `download` attribute, so a
  blocked or still-pending multiple-download prompt cannot turn the click into
  a navigation/reload or extra tab. Browsers do not expose the automatic
  downloads content setting through the Permissions API, so the page cannot
  pre-check whether the user has already allowed it; the modal tells the user
  to choose Allow when prompted. The
  legacy `GET /api/shares/:id/files/zip` endpoint still serves archives already
  on disk (and builds S3 archives on explicit request), but `share.complete`
  and `share.getMetaData` no longer create `archive.zip`; this avoids archive
  CPU/disk work after large uploads. `isZipReady` remains in the DTO for API
  compatibility.
- Public shares no longer require a share token, so their page makes a single
  data request instead of the old `403 -> token -> retry` cycle. Password,
  max-view, recipient-restricted and private reverse shares still require a
  token, and a stale token no longer blocks a share that is public.
- Fallbacks: if Valkey is disabled or unreachable, page-view metrics and the
  top-country list move to a per-process 24-hour memory window. The Valkey
  connection retries after 30s; cache reads fail open to SQLite. All Redis
  clients have error handlers and `disableOfflineQueue` so a dead Valkey
  server never hangs a request or crashes the backend.
- `update.sh` pulls origin/main, preserves `backend/.env` and locally modified
  branding assets, reinstalls and rebuilds both packages, installs the systemd
  units, runs migrations/seeding through the backend restart, and restarts the
  frontend. The standalone Prisma migration passes the production
  `DATABASE_URL` explicitly because Prisma CLI loads `backend/prisma/.env` after
  `backend/.env`; the systemd unit gets the same value from `backend/.env`. It
  must run as root: `sudo bash /var/www/pingvin_source/update.sh`.
- Keep an up-to-date database copy at `/home/rt/Documents/pingvin-share.db`
  (`sqlite3 ... "PRAGMA integrity_check;"` must return `ok`).
- The production reverse proxy must send `/api/*` directly to the backend
  (`127.0.0.1:8080`), not to the Next frontend on `3030`. The Next
  `/api/[...all]` route is only a development proxy; using it in production
  logs `API response ... exceeds 4MB`, buffers large uploads/downloads and
  contributes to aborted requests. Include `proxy_buffering off`,
  `proxy_request_buffering off` and long proxy timeouts on the API location.
- Cloudflare: bypass cache for `/sw.js` and purge old HTML/service-worker
  responses after deployments. Cloudflare does not cache HTML or JSON by
  default, so the origin headers only apply where a Cache Rule makes those
  paths eligible; scope that rule to the public HTML routes (including
  `/trending`), the public config, stats, `/api/shares/trending`,
  `/api/shares/:id/seo`, `/api/system/sitemap.xml`,
  `/api/system/robots.txt`, `/robots.txt` and `/sitemap.xml` rather than the
  whole site, and bypass requests carrying an
  `access_token` cookie if the rule uses an Edge TTL. Page HTML is cached for
  at most 60s, SEO JSON for 60s, sitemap XML for one hour, robots for one day
  and hashed `/_next/static` assets stay immutable. Angie/h5bp serves
  `/img` and `/favicon.ico` directly with its own long TTL (one year / one
  week), so the Next.js one-day rules do not apply there; purge the logo,
  dark logo, favicon, PWA icon and `og-image.png` URLs after an admin branding
  change. Public `?webp=300` previews are normal cacheable file GETs; keep the
  versioned query string in the file cache key so older 1600px previews are
  bypassed after deployment. If `/sw.js` was previously cached
  long-term, purge it once; `_app` also registers it with a build-hash query.

## Auth redirects

Post-login, post-TOTP, post-signup and authenticated-home redirects use a
full document navigation. A client-side navigation can reuse a prefetched
sign-in redirect for a protected page and loop between `/upload` and
`/auth/signIn`; the full navigation avoids that cache.

## SEO, structured data and image delivery

- `Meta` now emits one title, description, canonical URL and robots directive per
  page, plus Open Graph/Twitter tags, a 1200x630 OG image and JSON-LD. Query
  strings (including `?lang=` and `?recipient=`) are stripped from canonicals;
  `/s/:id` permanently redirects (308) to the canonical `/share/:id` page.
  Auth, account, admin, upload, edit, error and missing-share pages are
  `noindex, nofollow`; public routes are indexable with
  `max-image-preview:large`.
- `_app` emits an Organization + WebSite graph on public routes. The home page
  adds `SoftwareApplication`, `/trending` and public share pages add
  `CollectionPage` + `ItemList` data. Protected shares return only
  `{ indexable: false, id }` from `GET /api/shares/:id/seo`, so names, file
  names and descriptions never leak into crawler metadata.
- `GET /api/shares/:id/seo` replaces the SSR share `HEAD` probe. It is
  edge-cacheable for 60s and has a short in-process cache. The share page passes
  SEO metadata into `getServerSideProps`, so titles/descriptions are available
  in the first HTML response. Missing/expired/removed shares still return a real
  404.
- `GET /api/system/sitemap.xml` and `GET /api/system/robots.txt` generate the
  crawler artifacts. They are cached for ten minutes / one day in the existing
  cache-manager store: Valkey when `CACHE_REDIS_ENABLED=true` (recommended;
  `update.sh` enables it when Valkey is active), process memory otherwise.
  **Neither artifact is ever written to SQLite.** SQLite is only
  read on a sitemap cache miss to discover indexable public shares (complete,
  unexpired, no password/max views/recipient restriction, public reverse share,
  at least one file), capped at 45,000 URLs. The public `/sitemap.xml` and
  `/robots.txt` routes proxy those artifacts and fall back to static route rules
  if the backend is unavailable. The sitemap adds the static routes and optional
  legal pages; robots disallows private routes, API/short links, edit pages and
  query-string variants, then points at the absolute sitemap URL. Migration
  `20261024000000_add_performance_indexes` adds the missing SQLite indexes on
  `File.shareId`, `ShareRecipient.shareId`, share
  creator/reverse-share/expiration/listing columns. On the 15.5k-share local
  database the cold sitemap query dropped from ~12s to ~94ms; the cached
  artifact/query is ~4ms.
- Translation catalogues are lazy per locale and included in the active page's
  HTML/`__NEXT_DATA__` instead of importing all 34 files into `_app`. Moment
  locales load on demand only for non-English visitors. The trending widget is
  a lazy SSR chunk shown only on share and 404 pages; it is no longer rendered
  on the home page or `/upload`. The shared first-load JS dropped from ~744 kB
  to ~250 kB in the local production build; `/upload` dropped from ~707 kB to
  ~356 kB after removing the static MDEditor command import.
- Raster share images get a resized 300px WebP preview on first request
  (`?download=false&webp=300`, quality 82) cached under
  `uploads/_previews/v300/<shareId>/<fileId>.webp`. The backend checks the MIME
  type and size before opening a storage stream, keeps a short negative cache
  for unsupported formats (GIF/APNG/SVG/ICO and oversized files) and the
  gallery only requests WebP for convertible extensions. Preview caches from
  older dimensions are removed on backend startup. Original files remain
  untouched for downloads and the full-size image modal; protected shares keep
  `private` previews and public shares use the same day-long immutable CDN
  headers as normal files. Preview files are removed with their share/file.
- Gallery images use native lazy loading; videos use the shared `LazyVideo`
  component, which waits for `IntersectionObserver` before attaching `src` and
  requesting metadata. The logo remains eager because it is above the fold.
- The previous 100 MB inline-preview cap was removed (2026-10-24).
  `MediaPreviewGallery` and the file-list preview action now accept any
  supported image/video size; large videos still load metadata lazily through
  `LazyVideo` when near the viewport. A local 510.9 MB MP4 rendered one gallery
  card and the file-list preview action with no page overflow.
- The share page reserves SEO-derived gallery/file-list skeletons while the
  client share request is in flight, and renders the name/description/file
  count from the SEO payload immediately. In a throttled local run (1.2s share
  response) desktop CLS fell to ~0.055 and mobile CLS to ~0.001.
- The manifest link is versioned with `COMMIT_HASH`/`VERSION`
  (`/manifest.json?v=<build>`), so Cloudflare and browsers do not keep serving a
  stale manifest after a deployment.
- UI branding uses WebP (`logo.webp`, `logo-dark.webp`, PWA icon WebP variants)
  with PNG fallbacks, and the admin logo upload regenerates both formats plus
  `og-image.png`. The tracked logo PNGs were recompressed from ~160 kB to
  ~38 kB and their WebP versions are ~24 kB; PWA icons keep PNG for platform
  compatibility while listing WebP variants in the manifest. `update.sh` merges preserved local branding
  into the pulled tree instead of replacing the whole `img` directory, then
  runs `npm run assets:brand` before `next build`.

## Verified locally


- Node `22.23.3` production builds pass for backend and frontend. `npm run
  test:unit` passes all 23 tests, covering view limits, IP+User-Agent identity,
  Valkey/fallback throttling, uploader metadata, batched visitor writes,
  page-view metrics and trending ranking/eligibility/result cap. A local smoke
  run rechecked config/stats cache headers,
  share `HEAD`/token/view flow and rolling expiration; the aggregate cache and
  upload-throttle exemptions were reviewed without a live Valkey instance.
- A later sandbox pass (Node `26.12.1`, isolated copy of the local database)
  used Playwright for guest and signed-in pages: the owner edit modal now
  reuses the loaded share instead of fetching the whole share list, a
  recipient-only share kept its restriction, max-view value and recipients
  after an edit, deleting from the share page returned to `/upload` without a
  share 404, upload/share folder paths and the media gallery rendered, and
  public file/ZIP headers stayed cookie-free (`immutable` file / 60-second ZIP).
  No console errors or warnings appeared beyond the deliberate 404 page visit.
- A Playwright SEO/CWV pass covered `/`, `/trending`, public/protected shares,
  `/privacy`, sign-in, upload, account, admin, 404, `/robots.txt` and
  `/sitemap.xml` at 1366px and 390px, signed-in and guest. Every page had one
  H1, `main`/`header`/`footer`/`nav` landmarks, zero images without `alt`, zero
  horizontal overflow, valid canonical/robots tags and JSON-LD, and loaded the
  WebP logo. The sitemap parsed as valid XML with ~15.5k URLs on the local
  database copy; protected shares were excluded and noindexed. German SSR
  rendered translated dates and navigation. Only the intentional protected
  share `403` and missing-page `404` appeared as browser network console
  messages. The production build reports ~250 kB shared first-load JS (down
  from ~744 kB; upload is ~356 kB) and the WebP preview request returned
  `image/webp` at 952 bytes for a 3.1 kB JPEG. The cold sitemap query fell
  from ~12s to ~94ms after the index migration. The standalone server used by
  `update.sh` was also started directly and served `/`, German SSR, share
  metadata, `/robots.txt`, `/sitemap.xml` and WebP assets correctly. The old
  `/api/shares/sitemap` route is gone; the backend serves prebuilt robots/sitemap
  strings through the cache layer (second request ~4ms) and no sitemap/robots
  rows or tables exist in SQLite.
- The final CWV pass verified that `/` and `/upload` no longer render or request
  the trending widget, the manifest link includes the build hash, generated
  thumbnails are 300x225 WebP (216 bytes for the local test image), and the
  full-size modal uses the original file. With the share API delayed by 1.2s,
  the new skeleton measured CLS ~0.066 on desktop and ~0.0001 at 390px.
- The layout/UX follow-up removed the redundant header spacer and
  `space-between` distribution, so short pages no longer get a large gap below
  the header. `/trending` now shows a loading state and retries client-side
  when SSR returns an empty/undefined list instead of permanently rendering the
  empty message. Footer activity displays the top eight countries in a
  two-row, four-column desktop grid, and the first footer link is Home for
  guests and Upload for signed-in users.
- A follow-up caching review (local Node `26.12.1`; the server remains on
  `22.23.3`) rechecked that only query-free page shells are public, cacheable
  file/ZIP GETs stay free of `Set-Cookie`, the ZIP poll reuses the share data
  cache (no separate metadata key), and the footer's base counters no longer
  add a Valkey key. Query-string page variants remain `no-store`; missing share URLs
  still return their normal 404 status.
- A later cache/privacy pass confirmed that a light theme cookie still receives
  the public shell while a dark one is `no-store`; a signed-in request to a
  public share has no `user` in `__NEXT_DATA__` and restores the header/owner
  actions from `/api/users/me`; `/upload` and `/account` still render the user
  server-side. A public file stayed cookie-free with a day-long `ETag` response,
  a protected file stayed `private`, and a local Prisma migration used the
  explicitly passed test `DATABASE_URL` instead of `backend/prisma/.env`.
- A cookie-free limiter pass sent 91 requests with the same IP + User-Agent:
  exactly 90 succeeded, the 91st returned `429`, a request with a different
  User-Agent succeeded, and no response carried `Set-Cookie`. A browser visit
  had no `pingvin_visitor` cookie and the home page stayed publicly cacheable.
  The Valkey bucket-key path is covered by a unit test; this sandbox has no
  Valkey server, so the live Valkey round trip was not repeated here.
- The gallery was verified with a 40-file fixture: 30 cards from 35 supported
  files, 250px media boxes, unsupported formats excluded, video first-frame
  thumbnails rendered, and image/video thumbnails opened the full-size modal.
  The file list was checked at 1366px and 390px with no horizontal overflow;
  Ogg video rows expose only download, and the preview modal has view/download
  icon actions.
- Refactor checks against a copy of `/home/rt/Documents/pingvin-share.db`:
  share `HEAD` does not change the view count; a share `GET` increments
  `Share.views` immediately in SQLite and refreshes the rolling expiration;
  the last permitted max-view is allowed for file access while the next page
  view returns `403 share_max_views_exceeded`; visitor country, city, browser,
  OS and referrer are written to `uploader.json`.
- An earlier run verified the footer 24-hour metrics against a local Valkey 9.1
  instance: page views and country counts aggregate from the 24 hourly hashes,
  the hour-24 bucket is excluded while hour-23 is included, each bucket gets a
  25-hour TTL, and the endpoint falls back to the in-memory window when Valkey
  stops.
- Playwright against that database (11 smoke checks plus a 5-check upload
  flow): home page, footer stats, dynamic manifest, sign-in, account shares,
  share page with visitor badges and text preview, report modal, admin shares
  search/sort, admin users sort (plus page 2 via the API), missing-share/
  unknown-route 404 statuses, public file access with day-long cache headers,
  upload -> share creation -> share page -> ZIP button -> delete, and no
  JavaScript errors.
- API checks: reverse-share creation without an expiration field uses the
  100-day rolling expiration; 20 concurrent share views increment exactly 20;
  20 concurrent views against a 5-view limit yield exactly 5 successes and 15
  `403` responses; the IP+User-Agent visitor limiter returns `429` after 90
  requests and the hotlink guard redirects direct file requests to the share
  page. With the backend stopped, the frontend still renders the home page from
  its bundled default config.
- An earlier sandbox run without Valkey exercised the in-memory page-view and
  throttler fallbacks. The trending pass ran against a local Valkey 9.1
  instance.
- The live deployment was audited as a guest and as a test admin account:
  home, sign-in, upload, account pages, public/password/max-view/multi-file
  share pages, ZIP download, report modal, 404s, dynamic manifest,
  imprint/privacy and admin redirects. No console errors or broken assets;
  390px mobile and dark mode showed no horizontal overflow. Temporary QA shares
  were removed after the run.
- The trending widget was verified with 11 recent public media shares, a
  password share, a max-view share, a text-only share, a 6-day-23-hour-old
  share, an 8-day-old share and a share whose media was deleted. The endpoint
  returned the twelve eligible shares ordered by total views, included the
  seven-day-old share, excluded the eight-day-old share and all other cases,
  and dropped a share immediately after it was switched to password-protected,
  added back after it was made public again. The share and 404 pages rendered
  the widget server-side with twelve 150px-tall cards spanning the content
  width in a 4x3 desktop grid, a 3-column tablet grid, a 2-column/6-row mobile
  grid at 390px and zero measured layout shift; the home and upload pages no
  longer render or request the widget. Widget thumbnails use a 2px blur that
  clears on hover, the view
  badge is 14px, dark mode was checked, and click-through to `/share/<id>` was
  verified. The widget title links to the public `/trending` page, which renders
  the identical grid with up to 48 entries from `?limit=48`; full-page
  thumbnails are unblurred, the page fetches its data in `getServerSideProps`,
  has one listing (no duplicate footer widget), and is edge-cacheable as an
  anonymous shell.
- Navigating between share pages on the client now remounts the share view by
  share ID. Previously the page only fetched its files on mount, so clicking a
  trending thumbnail could leave the previous share's name, files and visitor
  data on screen under the new URL.
- Reset-password pages now set a browser title, and a missing local
  `archive.zip` returns `404` instead of `500` (both verified locally).
- `bash -n update.sh` passes; its env writer produces the exact live
  `DATABASE_URL` above.
- Optimization pass (2026-10-24): backend and frontend production builds pass,
  all 21 unit tests pass, and a 21-route Playwright run covered guest,
  signed-in and admin views, the upload/account pages, share preview and report
  modals, admin search/sort/pagination, mobile width, dark mode and 404s with
  zero console errors or warnings. Trending and page-view metrics were
  exercised against a real Valkey-compatible server: one
  `pingvin:trending:meta:<shareId>` key per share (8-day TTL), one MGET per
  ranking read, immediate metadata invalidation on edit, and one hourly
  metrics hash. A share view followed by an immediate shutdown still persisted
  the visitor, confirming the batched writer's shutdown flush. Public HTML
  shells returned the expected 60-second edge cache headers while
  authenticated and query-string requests stayed `no-store`; public file and
  ZIP responses carried the day-long immutable cache headers and ETag. The
  first deploy after the metadata key change starts with an empty trending
  list until shares are viewed again; old per-day hash keys expire on their
  own.
- Upstream-alignment/refactor pass (2026-10-24): the separate
  `share:meta:<shareId>` key was removed (the ZIP poll now reuses the share
  data cache), `getMetaData` no longer runs a query, share deletion invalidates
  once after removing files, and upload chunks touch `Share.updatedAt` at most
  once per five minutes per process. The admin share size sort is aggregated
  and paginated in SQL instead of loading every share into memory (20 rows on
  the 15.9k-share local database in ~20-40 ms), and the admin user list selects
  only DTO fields instead of password hashes and TOTP secrets. Unsupported
  gallery images no longer open a storage stream before the type check and are
  negatively cached. Verified with Node `26.12.1`: both production builds and
  all 23 unit tests pass; a Playwright guest/user run covered home, trending,
  share, privacy, imprint, sign-in, upload, account, admin shares/users, mobile
  width and the 404 page. An uploaded GIF+JPEG share requested a WebP preview
  only for the JPEG, admin size sorting returned ascending 0-byte rows on page
  1, page 2 and a filtered search returned 20 rows each, and the only console
  message was the deliberate missing-page `404`. Public HTML shells kept the
  60-second edge headers, public files kept the day-long immutable headers and
  ETag, and the share `HEAD` probe still returned 200/404 without changing the
  view count.

- VirusTotal background scanning (2026-10-24): both production builds pass and
  all 33 backend unit tests pass (10 new VirusTotal filter/verdict/queue/state
  tests). A local mock API run uploaded a mixed JPEG+PDF share and received a
  hash lookup only for the PDF; the lookup, upload and analysis poll arrived
  180.02s apart under the previous 180s setting. The clean analysis left the
  share untouched. A second ZIP
  share whose hash was reported malicious had its files deleted, its
  `removedReason` written, and its page changed to 404. A deliberately failed
  mock request was retried at the next slot and completed. Playwright guest,
  signed-in, admin and 390px checks showed one H1, no horizontal overflow and
  no console errors or warnings beyond the deliberate missing-page 404. No
  SQLite schema or migration was added.
- Live VirusTotal audit (2026-10-24, after deployment): a mixed JPEG+PDF share
  was uploaded through the live UI. The PDF report returned 0 malicious,
  0 suspicious, 63 undetected and 12 type-unsupported; the unique JPEG hash
  stayed absent (404), confirming safe-type filtering. The share remained
  online while the scan ran and was deleted afterwards (API and page both
  404). A final 12-page Playwright pass covered guest, signed-in and 390px
  mobile views with no non-intentional console messages. `/api/configs`
  returned the expected 30-second edge headers without `Set-Cookie`, and the
  share `HEAD` probe returned 200. The test account remains non-admin, so live
  admin pages were not audited.
- VirusTotal administrator dashboard (2026-10-24): the file-backed audit state
  (`DATA_DIRECTORY/virustotal/state.json`, mode `600`) was seeded and reloaded
  across a backend restart; 17 events and 15 calls were served through the
  admin-only API. The `/admin/virustotal` page rendered the status badges,
  last-hour/today/24h call cards, detection/removal counts, all events, the
  detections-only filter, creator/reverse-owner uploader details and the state
  file path at 1366px and 390px with no console errors or page overflow. A real
  local PDF scan added queued, uploaded and clean events and persisted them to
  the JSON file. The admin link was added to `/admin`; anonymous API access
  returned 403. All 38 backend tests pass (three audit-state tests and two
  malicious-file removal tests), and both production builds pass. No SQLite
  schema or migration was added.
- Empty ad-slot collapse (2026-10-25): with third-party ad requests blocked,
  the share-page ad container collapsed after 5s (`display:none`, zero height
  and margins) on a share with no gallery. Injecting a 300x100 iframe reopened
  it through the observer. The file list remained visible with no console
  errors. This removes the blank gap on shares without an image/video gallery
  when no ad fills.
- VirusTotal single-file removal (2026-10-25): a local share containing the
  EICAR test file and a clean PDF was scanned. VirusTotal flagged the EICAR
  file; only that file was deleted, while the PDF remained online (share 200,
  one file). The stale `archive.zip` was removed, `isZipReady` was reset, and
  `removedReason` stayed null. The admin event detail read `Offending file
  removed; 1 clean file retained`. Deleting the share afterwards returned 404.
  All 38 backend tests pass, including the new retained-file and empty-share
  cases.
- VirusTotal rate-limit change (2026-10-24): the shared request lock is now
  **173 seconds**, which allows exactly 500 request starts in a 24-hour window
  (499 intervals of 173s fit inside 86,400s) instead of the previous 480/day.
  The admin dashboard reads the limit from the service and therefore displays
  `1 request / 173s`. The spacing mechanism is unchanged and remains covered by
  the existing lock/audit tests.
- VirusTotal dashboard responsive pass (2026-10-24): Recent activity now uses
  the table at 1280px and 1366px, and 2-column cards at 1024px and 1-column
  cards at 768px/390px. All five widths had zero document/body horizontal
  overflow, the existing events/uploader/removal details remained visible, and
  the browser console stayed clean.
- Live non-admin audit (2026-10-24, after the admin-dashboard deployment): a
  17-page Playwright pass covered guest, non-admin user and 390px mobile views.
  Every page had one H1 and no horizontal overflow; there were no application
  console warnings and only the deliberate missing-page 404 (plus one external
  ad-image 404 at the network level). `/api/configs`, stats, trending, public
  files and ZIPs returned the expected cache headers without `Set-Cookie`.
  Anonymous `/admin/virustotal` redirected to sign-in; the non-admin user was
  redirected from both `/admin` and `/admin/virustotal` to `/upload`;
  `GET /api/admin/virustotal` returned 403 with no leaked dashboard content.
  The live build manifest includes the `/admin/virustotal` route. The dashboard
  itself was not opened live because the test account is non-admin.
- Live 173s re-audit (2026-10-24): the same 17-page guest/non-admin/mobile
  Playwright pass was repeated after the rate-limit change. All pages had one
  H1 and no horizontal overflow; only the intentional missing-page 404 appeared
  as an application console error, with two third-party ad-image 404s at the
  network level. Cache headers, public file/ZIP headers and share `HEAD`
  remained correct. Anonymous `/admin/virustotal` still redirected to sign-in;
  the non-admin user still redirected to `/upload` from both admin routes and
  received 403 from `GET /api/admin/virustotal`. The 173-second value is
  backend-side and admin-only, so it could not be read with the non-admin
  account; an admin dashboard capture is needed to confirm the displayed
  `1 request / 173s` live.
- Admin observability pass (2026-10-25): both production builds pass and all
  46 backend unit tests pass (new INFO parsing, memory fallback, pagination,
  deduplication, truncation and logger-forwarding cases). A local Valkey 8.10.2
  instance returned the dashboard card's memory, key, hit/miss, client and
  uptime values through one admin-only INFO call; the card rendered
  "Connected" with its version badge. Seeded browser errors appeared in
  `/admin/logs`, the copy button produced clipboard text containing them, the
  injected `window.onerror` reporter wrote a real browser error into the
  Valkey-backed Frontend tab, and pagination reached page 2 after more than 20
  entries. With Valkey stopped, the metrics API returned
  `configured=true, connected=false` and browser/backend logs moved to the
  process-memory store (`storage=memory`) without breaking the endpoints.
  Admin HTML and both admin APIs returned `no-store` cache headers. Playwright
  covered guest redirects, the signed-in dashboard and logs page at 1366px and
  390px, and the only console entry was the deliberately injected browser
  error; there was no horizontal overflow.
- Individual download pass (2026-10-25): `/share/h4Dr` with two files showed
  `2 files · 10.2 KB` without the old ZIP compression note, and "Download all"
  opened a confirmation modal explaining that the browser may ask to allow
  multiple downloads. After confirmation, Playwright received two separate
  downloads (`.jpg` and `.pdf`), no request was made to `/files/zip`, the page
  stayed on the share URL, and a single-file row download still worked. The
  same flow passed with the non-admin account at 390px with no overflow or
  console errors. A newly completed two-file share had no `archive.zip`,
  remained `isZipReady=false`, and its legacy ZIP endpoint returned `404`,
  confirming that completion no longer builds archives. Backend tests pass
  (46) and both builds/lints pass.
- Live individual-download audit (2026-10-25, after deployment): with the
  non-admin account only, a temporary two-file public share completed with
  `isZipReady=false`, no `archive.zip`, and a `404` from the legacy ZIP
  endpoint. The share page showed `2 files · 21 B` without the ZIP note,
  "Download all" opened the confirmation modal with the multiple-download
  hint, and the browser received both files separately with no `/files/zip`
  request and no page navigation. The mobile 390px view had no overflow, the
  non-admin account still received `403` from both admin APIs and a `307` to
  `/upload` from both admin pages, and a real-ad share-page load produced no
  console errors or warnings. The temporary share was deleted afterwards.
- Admin logs capture is runtime-only: a process restart clears the memory
  fallback, and startup errors logged before `app.useLogger` are only in
  systemd's journal. On the live deployment the backend captures errors from
  that point forward into Valkey, so the viewer is intended for diagnostics
  rather than a complete journal replacement.

## Known non-issues

- The ad container reserves about 90px plus 24px margins while third-party
  tags load, then collapses after 5s if no ad content is present. A
  `MutationObserver` reopens it if an ad arrives later. The media gallery is
  absent only when the share has no supported image/video files.
- Backend lint reports upstream warnings only.
- A fresh data directory logs one `ENOENT` from the temporary-file cron.
- Chrome may log the expected `403` while a protected share page fetches its
  share token, and `404`s for intentionally missing shares. These are network
  status logs, not JavaScript exceptions; the page recovers and renders
  normally. Public shares no longer make the token request.
- Node 24+ prints an upstream `util._extend` deprecation warning at frontend
  startup.
