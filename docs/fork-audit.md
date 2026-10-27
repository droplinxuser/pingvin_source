# Fork maintenance notes

`droplinxuser/pingvin_source` is a lightly customized fork of
`smp46/pingvin-share-x`. Keep custom code out of upstream files where possible
so `git merge upstream/main` stays small.

## Custom areas

| Area | Main files |
|---|---|
| Environment loading / production config | `backend/src/constants.ts`, `backend/src/config/config.service.ts`, `backend/src/main.ts`, `backend/.env.example` |
| Rolling 100-day expiration | `backend/src/share/share.util.ts` (`SHARE_EXPIRATION`), migrations `20261016000000` / `20261016000001`, share create/edit modals |
| Admin pagination, search and sorting | `backend/src/share/share.service.ts`, `backend/src/user/user.service.ts` (quota columns sorted and paged in SQL), `frontend/src/pages/admin/*`, `frontend/src/components/core/SortIcon.tsx` |
| Share reports | `backend/src/share/dto/reportShare.dto.ts`, `backend/src/email/email.service.ts`, `frontend/src/components/share/showReportShareModal.tsx` |
| Uploader metadata / visitors | `backend/src/utils/uploaderInfo.util.ts`, `ShareDTO.uploaderInfo`, `frontend/src/components/share/UploaderInfoBadges.tsx`, `ShareStats.tsx`; view counts stay in `Share.views`, written in five-second batches for unlimited shares and atomically for limited ones (`shareState.service.ts`). Geo labels are clamped before storage. The recent-visitor list is shown to every visitor (guest, owner, administrator) |
| Reverse-share use limits | `backend/src/reverseShare/reverseShare.service.ts` (`reserveUse` / `refundUse`), `backend/src/share/share.service.ts` (reserve at create, reject invalid cookies, no refund on revert) |
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` (up to 100 supported image/video cards at 250px, revealed in 12-card lazy batches with a skeleton card; videos show a skeleton until their lazy first frame loads; every image/video in the share is available from the popup through previous/next buttons and ArrowLeft/ArrowRight); `frontend/src/components/core/LazySection.tsx` reserves space for the gallery, file list, comments and visitor insights |
| Individual downloads / legacy ZIP | `frontend/src/components/share/DownloadAllButton.tsx` (confirmation + sequential per-file downloads), `frontend/src/services/share.service.ts` (anchor-based downloads), `backend/src/share/share.service.ts` (no automatic archive creation); existing `archive.zip` files remain served by the legacy API. The share file count uses `share.custom.fileCount` without the old ZIP note. |
| Share and file size limits | `backend/prisma/seed/config.seed.ts` (`share.maxSize` 5 GB, `share.maxFileSize` 512 MB), migration `20261025000000_raise_share_size_limit`, `backend/src/share/share.util.ts` (`resolveShareSizeLimit`), local/S3 upload guards, `frontend/src/components/upload/Dropzone.tsx` and upload pages |
| Trending today | `backend/src/cache/trending.service.ts`, `GET /api/shares/trending?limit=100`, `frontend/src/components/share/TrendingToday.tsx` (client-side, viewport-triggered load with batched rendering and skeletons), `frontend/src/components/share/TrendingCountries.tsx` (up to ten countries, ten shares each), `frontend/src/pages/trending.tsx`, `frontend/src/pages/_app.tsx` |
| New shares | `backend/src/cache/trending.service.ts` (`getRecent`), `GET /api/shares/recent?limit=200`, `frontend/src/pages/new.tsx`, shared `TrendingToday` grid/card (`loadItems`, media badge, 24-card batches), header/footer links, sitemap/robots |
| Shared UI polish | `frontend/src/components/core/RelativeTime.tsx` (relative timestamps + full-date tooltip), `RouteProgress.tsx` (global navigation bar), `LazyImage.tsx` (lazy images with shimmer placeholder), `LazySection.tsx` / `LazyVideo.tsx`, `frontend/src/utils/filePreview.util.ts` (lazy file-preview modal chunk) |
| Legal pages | `frontend/src/components/legal/LegalDocument.tsx` (shared imprint/privacy markdown layout, one H1 and canonical JSON-LD) |
| Upload paste and folder picks | Upstream `frontend/src/hooks/useClipboardPaste.hook.ts`, `utils/file.util.ts` and `utils/folder.util.ts`; the fork adds `share.maxFileSize` validation in `components/upload/Dropzone.tsx`, keeps the folder button, and validates upload-init/complete/abort with `backend/src/file/dto/upload.dto.ts` (safe names, bounded chunks/parts) |
| Share thumbnails / OG | `backend/src/file/file.service.ts` (share-level 300px WebP, ordered preview fallbacks, background queue, 32-day cleanup), `backend/src/share/preview.util.ts` (shared source selection and `getPreviewCandidates`), `GET /api/shares/:id/thumbnail`, `frontend/src/components/share/TrendingToday.tsx`, `TrendingCountries.tsx`, `Meta.tsx` |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts` (shared `Cache-Control`, `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, public-file `ETag`, `If-None-Match` 304 handling, per-share cache epochs), `frontend/src/utils/version.util.ts` (build-versioned public config/provider URLs), `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts` (query-free anonymous page shells; its `no-store` decision is authoritative), `frontend/next.config.js` (`/s/:shareId` redirect, PWA precache exclusions) |
| Per-IP+User-Agent rate limiting | `backend/src/utils/visitorIdentity.util.ts`, `backend/src/cache/valkeyThrottler.storage.ts`, `backend/src/cache/throttler.config.ts`, `backend/src/main.ts` |
| Valkey/Redis cache | `backend/src/utils/cache.util.ts`, `backend/src/share/shareState.service.ts`, `backend/src/cache/cache.module.ts`, `backend/src/cache/valkey.service.ts` |
| VirusTotal background scanning | `backend/src/virustotal/*` (worker, file-backed audit, admin controller), `backend/src/share/share.service.ts` (completion hook), `backend/src/share/share.module.ts`, `backend/src/clamscan/clamscan.service.ts` (shared malicious-share removal), `frontend/src/pages/admin/virustotal.tsx`, `backend/.env.example` |
| Site stats and footer | `backend/src/system/system.service.ts`, `backend/src/cache/metrics.service.ts`, `frontend/src/components/footer/Footer.tsx`; `POST /api/system/pageview` |
| Valkey metrics and error logs | `backend/src/cache/valkeyMetrics.util.ts`, `backend/src/logs/*`, `backend/src/system/system.controller.ts` (`GET /api/system/valkey`), `frontend/src/components/admin/ValkeyMetricsCard.tsx`, `frontend/src/pages/admin/logs.tsx`, `frontend/src/services/log.service.ts`, `frontend/src/utils/errorReporter.util.ts` |
| Home copy and ads | `frontend/src/pages/index.tsx` (upstream layout and redirect), `home.custom.*` keys in `en-US.ts`, `frontend/src/components/Ads.tsx` (guest-only: resolves `useUser`, the `access_token` cookie and the `reverse_share_token` cookie before mounting the ad slot; the share page also skips the slot for password-protected shares), so signed-in visitors and protected shares load none of the three publisher scripts; upstream `hooks/homeHref.hook.ts` owns every "go home" target (honours `general.showHomePage`, `security.allowUnauthenticatedShares` and the signed-in state), including the share error screen, breadcrumb, error modals and post-delete redirect |
| Fork branding / deployment | `frontend/public/img/**`, `frontend/public/favicon.ico`, `frontend/src/pages/manifest.json.tsx`, `pingvin-*.service`, `update.sh` |
| SEO / crawlers | `frontend/src/components/Meta.tsx`, `SiteStructuredData.tsx`, `frontend/src/hooks/siteMeta.hook.ts`, `frontend/src/pages/robots.txt.tsx`, `frontend/src/pages/sitemap.xml.tsx`, `frontend/src/utils/seo.util.ts` (`DEFAULT_SITE_NAME`, `buildWebsiteRef`, `buildBreadcrumbList`, `buildItemList`, `buildCollectionPage`, `getShareSubject`, auto share descriptions), `frontend/src/utils/seo.server.util.ts` (`fetchShareSeo`, `fetchShareList`), `backend/src/share/share.service.ts` (`getSeo`, 60-second `share:seo` cache invalidated with the share data), `backend/src/system/system.service.ts` (disk-backed `getRobotsTxt`, 50k-entry sitemap index/chunks, `getSitemapFile`) |
| WebP / image pipeline | `backend/src/file/file.service.ts` (per-file preview cache + share-level listing/OG thumbnail), `backend/src/file/file.controller.ts` (`webp=300`), `backend/src/config/logo.service.ts`, `frontend/src/utils/file.util.ts`, `frontend/src/components/Logo.tsx`, `frontend/public/img/*.webp`, `og-image.png` |

Fork-only UI strings live in `frontend/src/i18n/translations/en-US.ts`; every
other locale falls back to English through `frontend/src/utils/i18n.util.ts`,
so translations do not need a fork-specific edit on each upstream merge. New
fork strings must use new `*.custom.*` keys: reusing an upstream key would make
other languages show the upstream copy instead of the English fallback.

Shared fork-only backend helpers live in `backend/src/utils/`:
`keyedLock.util.ts` serializes per-share read-modify-write tasks (visitors,
comments), and `fileWrite.util.ts` writes JSON/state files through a unique
temporary file plus atomic rename. Reuse them instead of adding another
hand-rolled lock or temp-file block.

## Merge checklist

1. `git fetch upstream && git merge upstream/main` on a branch.
2. Resolve conflicts mainly in `share.service.ts`, the share create/edit modals,
   `createShare.dto.ts` / `createReverseShare.dto.ts`, and the upload files
   (`Dropzone.tsx`, `pages/upload/index.tsx`, `utils/file.util.ts`). Keep the
   upstream clipboard/folder helpers and re-apply only the fork per-file cap,
   folder button and dropzone copy.
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
   widget title and full `/trending` page with up to 100 cards showing name,
   description, file count, size, relative upload date and views over a lightly
   blurred preview that clears on hover, the new `/new` page (200 newest media shares,
   image/play badges, header/footer links), file download headers, report modal, footer
   page-view/top-country
   metrics, the dynamic `/manifest.json`, and the disk-backed `/sitemap.xml`
   index plus a versioned `/api/system/sitemaps/sitemap-N.xml` chunk (one
   `<loc>` per index entry, no more than 50,000 `<url>` entries per chunk).
   Repeat once with Valkey stopped
   to confirm the fallbacks (the trending widget is hidden without Valkey).

## Production settings

- `security.allowRegistration=false`
- `oauth.allowRegistration=true`
- `oauth.disablePassword=false`
- `share.maxSize` is 5 GB for one share and `share.maxFileSize` is 512 MB for
  each file. The per-file cap keeps every individual download within
  Cloudflare's 512 MB cacheable-file limit; multi-file shares are downloaded
  file by file instead of as an archive. The existing value migration raises
  the old 512 MB setting on deployed databases, while fresh installs get the
  new defaults from the seed. `config.example.yaml` documents both keys.
- `share.maxExpiration` / `share.defaultExpiration` are intentionally removed
  from the seed and the share/reverse-share create/update DTOs; expiration is
  rolling and automatic.
- Report notifications use `REPORT_EMAIL` from `backend/.env`, falling back to
  the configured SMTP sender.
- `backend/.env` is authoritative for the backend and systemd unit. Keep the
  live database URL exactly:
  `DATABASE_URL="file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1"`
- `DATA_DIRECTORY="/var/www/pingvin_data"`; uploader/visitor metadata is stored
  per share at `uploads/shares/<shareId>/uploader.json` with mode `600`. Sitemap
  files and their manifest are written to
  `DATA_DIRECTORY/sitemaps/<site-hash>/`; they are derived data and can be
  deleted at any time (the next request rebuilds them). View
  counts live in `Share.views` and are updated directly in SQLite. Visitor
  writes are batched for one second per share: the response still includes the
  new visitor immediately, while a burst of views produces a single atomic
  file write (pending entries are flushed on shutdown). The last persisted
  visitor list is kept in a bounded in-process snapshot (256 shares), so views
  after a flush do not read and parse `uploader.json` again; edits/deletes drop
  the snapshot, and shutdown only writes entries with unflushed views.
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
  visitor bucket so SSR and large uploads keep working. File and ZIP reads also
  skip it: they keep the dedicated 1200/min per-route file limit, while an
  image-heavy share page can request dozens of previews without exhausting the
  90/min navigation budget. File GETs stay cache-friendly because the response
  never needs a visitor cookie.
- Valkey/Redis is optional but recommended: set `CACHE_REDIS_ENABLED=true` and
  `CACHE_REDIS_URL=redis://127.0.0.1:6379` in `backend/.env` (`update.sh`
  enables both automatically when a local `valkey-server` is active). Share-page
  data and guard data are cached for 30s each, and a cold-cache burst shares one
  in-flight load instead of issuing one query per request. A data-cache miss
  also resets the rolling expiration to 100 days in the response; the
  corresponding SQLite write is throttled to once per six hours per share and
  process, so a popular share does not cause an `UPDATE` per view. Share view
  counts are written directly to SQLite; shares without a view limit use a
  single atomic update, while limited shares use one conditional
  `UPDATE ... RETURNING` so the limit check and increment cannot race. Visitor
  metadata is coalesced into one `uploader.json` write per second and per share,
  and pending entries are flushed on shutdown. The footer's base counters use a
  60-second in-process cache and do not add a Valkey key.
- VirusTotal scanning is optional: `VIRUSTOTAL_API_KEY` in `backend/.env`
  enables it. The optional `VIRUSTOTAL_API_URL` exists only for a local stub or
  proxy. On completion, only non-media/plain-text files are queued; raster
  images, audio, video and plain structured text are skipped while SVG is
  scanned. Password-protected ZIP/ZIPX, 7z and RAR4/RAR5 archives are detected
  before a queue entry is created: the scanner reads only archive headers and
  central directories, records a `skipped` audit event, and makes no API call
  or queue entry. Detection is best-effort; malformed or unreadable archives
  fall back to the normal scan, and a 7z with a compressed header that hides
  its coder list may also fall through to scanning. The queue is a 1000-job
  Valkey list
  (`pingvin:virustotal:queue`, process-memory fallback) and every API step
  (hash lookup, upload, analysis poll) waits for a
  `pingvin:virustotal:request` lock with a 173-second TTL, so at most 500
  requests can start in any 24-hour window (the free-tier daily cap) while the
  shared Valkey lock is available, even across restarts or instances.
  Without Valkey the same spacing is enforced per process. Files are hashed
  locally and looked up by SHA-256 first; they are uploaded only when unknown,
  up to 512 MB (files above 32 MiB use VirusTotal's large-file upload URL,
  which also requires the `x-apikey` header).
  Terminal verdicts are cached as one `pingvin:virustotal:verdict:<sha256>` key
  for seven days. Confirmed malicious SHA-256 values are also appended to a
  permanent static ledger at
  `DATA_DIRECTORY/virustotal/malicious-hashes.txt` (one hash per line, mode
  `600`), loaded once at startup, so re-uploading a known malicious file is
  removed immediately without an API request. Clean and suspicious verdicts
  stay in the seven-day Valkey cache and are rechecked, because a clean result
  can become malicious as VirusTotal signatures change. HTTP 429 sets a
  cooldown key, 401 pauses scanning until the backend restarts, 403 is treated
  as a per-operation ForbiddenError, and 5xx/network failures retry up to three
  times. A malicious VirusTotal verdict removes only the offending file and
  keeps clean files online. If no files remain, the share gets a
  VirusTotal-specific `removedReason` and returns 404; otherwise its stale ZIP
  is deleted and `isZipReady` is reset. The registered share creator (or the
  reverse-share owner for an anonymous upload) receives an email naming the
  removed file, the share, and whether clean files remain; an SMTP failure is
  logged without interrupting the scan.
  No replacement archive is built because automatic ZIP generation is disabled.
  ClamAV continues to remove the whole share. No scan state is written to SQLite.
  Operational history is file-backed at
  `DATA_DIRECTORY/virustotal/state.json` (mode `600`): the latest 200 events,
  48 hours of API-call timestamps and 30 days of daily counters. The
  administrator page `/admin/virustotal` (API `GET /api/admin/virustotal`,
  admin-only, auto-refreshes every 15s) shows scanner/queue/cooldown status,
  API calls for the last hour/today/24h, scan and detection counters, and
  recent events. Events record queued/uploaded/clean/suspicious/malicious
  results, errors, 429 cooldowns and 401 pauses. A malicious event captures
  the share creator, the reverse-share owner and the uploader metadata before
  the files are deleted. This state file and the malicious-hash ledger are
  included in the data-directory backup; no SQLite table or migration is used.
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
  (`pingvin:trending:views:<day>`, 31-day TTL) and writes
  `{ id, name, description, previewFileId, previewKind, fileCount, size,
  createdAt }` to one per-share key (`pingvin:trending:meta:<shareId>`, 31-day
  TTL) in the same `MULTI` with `SET ... NX`. The metadata is immutable until
  the share is edited, so a view only writes it once instead of sending the
  payload on every visit; the thirty-one-day TTL still covers the thirty-day
  ranking window. Ranking reads use a unique temporary `ZUNIONSTORE` key with
  a one-minute TTL and delete it in the same `MULTI`, so two concurrent reads
  cannot delete each other's union. Cold ranking/country reads are coalesced in
  process so one request rebuilds the result and the rest share it.
  Descriptions are whitespace-normalised and capped at 240 characters so one
  card cannot inflate the cache key. On the first ranking read after a deploy,
  entries that still lack `fileCount`/`size` or the current preview version are
  backfilled in one SQLite query (name, description, files and upload state),
  written back with `SET ... EX`, and then served from cache; deleted,
  non-media and older-than-thirty-days shares are purged. This and the seed
  below are the only SQLite reads in the trending path. The view badge
  still comes from the sorted-set score. One metadata entry per share replaces
  the old per-day copies. Shares older than thirty days and shares without an
  image/video are skipped before writing. `GET /api/shares/trending` unions the
  thirty daily sets with `AGGREGATE MAX`, reads every candidate's metadata with
  a single `MGET`, drops entries without current metadata or older than thirty
  days, and returns the top twelve ordered by total views from Valkey alone in
  the normal path (legacy entries may trigger the one-time backfill above).
  Because daily buckets written under the old seven-day window expired before
  the 30-day window shipped, shares whose last view was more than eight days
  ago had no score left. The first ranking read for a given window size checks
  `pingvin:trending:seed:<windowDays>`; when absent, one SQLite query selects
  public, unexpired, media shares created inside the window with at least one
  view, and one `MULTI` writes their total-view scores into the current day's
  set plus one metadata key each (`SET ... NX`, 31-day TTL) before writing the
  marker. This makes the 30-day ranking complete immediately instead of
  waiting for old shares to be viewed again. The marker contains the window
  size, so changing `WINDOW_DAYS` seeds again automatically; once seeded, reads
  remain cache-only. If SQLite is unavailable the seed attempt is retried at
  most every five minutes and the read still serves whatever Valkey has.
  Each item carries the share name, description, file count, total size,
  upload date and preview kind, so the cards can show those details without
  additional requests.
  `?limit=100` returns the full list for the public `/trending` page; other
  values are clamped to 100. The result is cached in-process for 30 seconds and
  is edge-cacheable for 60 seconds. The browser service caches the public list
  for 30 seconds and the country list for five minutes. Pages no longer fetch
  trending during SSR: `TrendingToday` waits until the section is near the
  viewport, then requests the list from the browser. A same-size skeleton grid
  holds the section open until the cards arrive, so the first share request is
  never delayed by the ranking request and the page does not jump when it
  loads. Editing, expiring or deleting a share (including removing its files
  or reverse-share parent) deletes its metadata immediately. If Valkey is
  unavailable the endpoint returns an empty list and the widget is hidden.
  Trending cards use a dark gradient over a lightly blurred preview; hovering
  clears the blur and restores the image brightness while the name,
  description, file count, size, upload date and view count stay readable. The
  grid is one column on phones, two on small tablets, three on laptops and four
  on wide screens.
- "New shares" at `/new` is the recent counterpart of `/trending`. It reuses
  `TrendingToday` (same card, grid, skeleton and responsive layout) with a
  `loadItems` callback and a media-type badge; the header shows "New" after the
  upload link and the footer links it after Trending. `GET /api/shares/recent`
  returns up to 200 public, unexpired, non-removed shares created in the last
  scan of the newest 1,000 rows, with at least one renderable image/video
  preview and no password/max views/recipient/private
  reverse-share restriction, ordered by upload date descending. The same
  preview helper as trending chooses the thumbnail; `hasVideo` marks any share
  containing a video so the card shows a play icon even when the thumbnail is
  an image, while image-only cards show an image icon. Zero-view shares are
  included. The list is cached in-process for 30 seconds, invalidated by
  edits/deletes, and served with a 60-second edge TTL. `/new` is part of the public
  anonymous shell cache, the crawler allow list and the sitemap. The missing
  file guard in `LocalFileService.get` returns 404 instead of letting a missing
  on-disk file emit an unhandled stream error.
- The footer posts to `POST /api/system/pageview` on every rendered page. The
  endpoint increments a per-hour Valkey hash atomically (one total field plus
  one field per country), expires each hourly bucket after 25 hours and reads
  the last 24 hours of page views plus the top eight countries (four columns
  per row on desktop). The aggregate is
  cached in-process for 30s so page views in that window reuse one 24-hour
  hash scan instead of triggering a scan every ten seconds. Only the 24 hourly
  hashes are stored; no
  per-visitor sets are
  kept. The POST response is never cached. `GET /api/system/stats` remains a
  read-only fallback and is edge-cacheable for 60s; its user/share/file/storage
  totals are fetched in one SQL query and cached in-process for 60s.
- `GET /api/configs` is edge-cacheable for 30s and the server-side
  `fetchConfig` helper keeps a 30s in-process copy (5s for bundled defaults),
  so middleware and SSR do not call the backend on every page.
  The bundled fallback config includes the upload/share keys used during SSR
  (`share.chunkSize`, `share.maxSize`, `share.maxFileSize`, `share.shareIdLength`,
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
  Every file is capped at 512 MB on upload, so each download stays within
  Cloudflare's edge cache limit.
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
  responses after deployments. Purge `/robots.txt` after a deployment that
  changes the allow list (the origin is correct immediately, but the edge copy
  is cached for a day). Cloudflare does not cache HTML or JSON by
  default, so the origin headers only apply where a Cache Rule makes those
  paths eligible; scope that rule to the public HTML routes (including
  `/trending` and `/new`), the public config, stats, `/api/shares/trending`,
  `/api/shares/recent`, `/api/shares/:id/seo`, `/api/shares/:id/thumbnail`,
  `/api/system/sitemap.xml`,
  `/api/system/sitemaps/*` (the versioned chunks), `/api/system/robots.txt`,
  `/robots.txt` and `/sitemap.xml` rather than the
  whole site, and bypass requests carrying an
  `access_token` cookie if the rule uses an Edge TTL. Page HTML is cached for
  at most 60s, SEO JSON for 60s, the sitemap index for one hour, versioned
  sitemap chunks for one day, robots for one day
  and hashed `/_next/static` assets stay immutable. Angie/h5bp serves
  `/img` and `/favicon.ico` directly with its own long TTL (one year / one
  week), so the Next.js one-day rules do not apply there; purge the logo,
  dark logo, favicon, PWA icon and `og-image.png` URLs after an admin branding
  change. Public `?webp=300` previews are normal cacheable file GETs; keep the
  versioned query string in the file cache key so older 1600px previews are
  bypassed after deployment. If `/sw.js` was previously cached
  long-term, purge it once; `_app` also registers it with a build-hash query.

## Auth redirects

Post-login, post-TOTP and post-signup redirects use a full document navigation.
A client-side navigation can reuse a prefetched sign-in redirect for a protected
page and loop between `/upload` and `/auth/signIn`; the full navigation avoids
that cache. "Go home" links and the home-page redirect use the upstream
`useHomeHref` helper instead of hardcoded `/` links.

## SEO, structured data and image delivery

- `Meta` now emits one title, description, canonical URL and robots directive per
  page, plus Open Graph/Twitter tags, a 1200x630 OG image and JSON-LD. Query
  strings (including `?lang=` and `?recipient=`) and trailing slashes are
  stripped from canonicals; `/s/:id` permanently redirects (308) to the
  canonical `/share/:id` page. Open Graph also emits `og:image:secure_url` on
  HTTPS and Twitter carries `twitter:url` plus image dimensions when known.
  Auth, account, admin, upload, edit, error and missing-share pages are
  `noindex, nofollow`; public routes are indexable with
  `max-image-preview:large`.
- Share metadata is generated automatically when the owner leaves the title or
  description empty. `seo.util.ts` derives a label from the owner's name, the
  common folder, or the first file name (stripping extensions and bulk-upload
  `(1)` suffixes), then builds a localized title such as
  `photos — 23 files to download` and a 160-character description containing
  the file count, total size, content mix (photos/videos/audio/documents/
  archives) and the first file names. Owner-written descriptions take priority
  and are followed by a short count/size summary. The same derived label is
  used for the visible H1, breadcrumb and JSON-LD, so the page and search
  result match. Protected shares never derive or expose a label.
- `_app` emits an Organization + WebSite graph on public routes. The home page
  adds `SoftwareApplication`; `/trending` and `/new` add `CollectionPage` +
  `ItemList` (the first fifty rendered shares, with thumbnail URLs); public
  share pages add `CollectionPage` + `ItemList` and a `BreadcrumbList` that
  matches the visible breadcrumbs; privacy/imprint add home breadcrumbs. The
  WebSite `@id` is shared by the site graph and page `isPartOf` references.
  Protected shares return only `{ indexable: false, id }` from
  `GET /api/shares/:id/seo`, so names, file names and descriptions never leak
  into crawler metadata.
- `GET /api/shares/:id/seo` replaces the SSR share `HEAD` probe. It is
  edge-cacheable for 60s and has a short in-process cache. The share page passes
  SEO metadata into `getServerSideProps`, so titles/descriptions are available
  in the first HTML response. Missing/expired/removed shares still return a real
  404.
- `GET /api/system/sitemap.xml` and `GET /api/system/robots.txt` build the
  crawler artifacts from SQLite and write the sitemap files to
  `DATA_DIRECTORY/sitemaps/<site-hash>/` on disk. The top-level `sitemap.xml`
  is a sitemap index; URL sets are split into `sitemap-N.xml` files capped at
  50,000 entries each. Every chunk URL in the index carries a content-hash
  version query (`/api/system/sitemaps/sitemap-1.xml?v=<hash>`) and robots
  points at `/sitemap.xml?v=<index-hash>`, so a content change gets a new
  cache key while unchanged files are not rewritten. The chunk endpoint reads
  the file from disk and is edge-cacheable for one day; the index is
  edge-cacheable for one hour. Files refresh after ten minutes; old chunks are
  retained for a day so a cached index never points at a deleted file, then
  removed. A request for an existing chunk is served directly from disk without
  refreshing a stale manifest; only a missing chunk triggers the rebuild.
  **Nothing is stored in SQLite, Valkey or process memory.** The
  public `/sitemap.xml` and `/robots.txt` routes proxy those artifacts and fall
  back to static route rules if the backend is unavailable. Robots allows
  `/sitemap.xml` and `/api/system/sitemaps/` because the index/chunks carry
  query strings and live under the otherwise disallowed `/api` tree; it also
  allows `/api/shares/*/thumbnail*` so the images used by `og:image`, social
  cards and rich results stay crawlable. The
  sitemap adds the static routes and optional legal pages; SQLite is read once
  per refresh to discover indexable public shares (complete, unexpired, no
  password/max views/recipient restriction, public reverse share, at least one
  file). Migration
  `20261024000000_add_performance_indexes` adds the missing SQLite indexes on
  `File.shareId`, `ShareRecipient.shareId`, share
  creator/reverse-share/expiration/listing columns. On the 15.5k-share local
  database the cold sitemap query dropped from ~12s to ~94ms; the served index
  and chunk reads take ~3ms.
- Translation catalogues are lazy per locale and included in the active page's
  HTML/`__NEXT_DATA__` instead of importing all 34 files into `_app`. Moment
  locales load on demand only for non-English visitors. The trending widget is
  a lazy SSR chunk shown only on share and 404 pages; it is no longer rendered
  on the home page or `/upload`, and its ranking request starts in the browser
  only when the widget approaches the viewport. The shared first-load JS
  dropped from ~744 kB to ~250 kB in the local production build; `/upload`
  dropped from ~707 kB to ~356 kB after removing the static MDEditor command
  import.
- `/trending` and `/new` now server-render their first listing batch (100 and
  200 items respectively, with the first 24 cards painted in the HTML) inside
  `getServerSideProps`, so the first cards and crawlable links no longer wait
  for a post-hydration API round trip. The HTML is edge-cacheable for 60s;
  client-navigation data responses (`/_next/data/...`) are explicitly
  `no-store`, because caching one empty response during a deployment would
  crash every client transition. The page components also default
  `initialItems` to `[]` and fall back to their existing client fetch. The
  JSON-LD ItemList uses the first fifty rendered shares.
- `getConfigValue` tolerates a missing config array so a malformed or
  deployment-time empty page payload cannot take down the whole app shell.
- The file-preview modal is split into a lazy chunk
  (`utils/filePreview.util.ts` + `showFilePreviewModal`), so markdown rendering
  and all preview types are downloaded only when a visitor opens a file. This
  reduced the share route from ~24.4 kB to ~16.3 kB page JS (323 kB to 316 kB
  first load) while keeping the same modal behaviour.
- The footer page-view/stats request starts in `requestIdleCallback` (or after
  800ms) instead of immediately after hydration. Its country grid reserves
  eight skeleton slots while loading, so the footer no longer grows when the
  counters arrive and shifts every section above it.
- The first WebP-eligible image in a public share is emitted as
  `<link rel="preload" as="image">` from the SEO payload, starting the gallery
  thumbnail fetch before hydration actually mounts the gallery. GIF gallery
  cards now use the backend's first-frame WebP preview (the full-size modal
  still serves the original animated file).
- `ShareActions` reserves the Download all button from the SEO file count
  before the share payload arrives. On phones the action row used to grow from
  one Report button to a wrapped row after the API response, moving the whole
  page; the reserved slot removes that shift (live mobile `/share/tUGS` CLS
  measured ~0.003 locally with a 1.8s delayed share response, down from 0.214).
- The share page defers its heavy sections with `components/core/LazySection`:
  the media gallery, file list, comments and visitor insights mount when they
  are within 400-600px of the viewport. Each section renders its matching
  skeleton first (or a dedicated skeleton component exported beside it), so
  the space is reserved and the page does not shift when the content arrives.
  The comments request is therefore only sent when the section approaches the
  viewport; the gallery/file list data still comes from the single share
  response. The observer uses a very large top root margin so a section skipped
  by a fast End-key or anchor jump is still observed after it moves above the
  viewport; a plain observer can miss that transition because both positions
  are "not intersecting". Native `loading="lazy"` and `LazyVideo` continue to defer the
  actual media bytes. The full-size file modal is centered, capped at the
  viewport height, hides its own overflow, and sizes images/videos with
  `max-width`/`max-height` and `object-fit: contain`, so portrait, landscape
  and video previews never add a scrollbar at desktop or phone widths (long
  text previews keep an inner scroll area). Share file names and the visitor
  referrer/direct text use the normal body weight instead of a semibold
  weight, keeping the list and visitor cards visually quiet. OS and browser
  glyphs use compact brand colors (Windows/Edge blue, Chrome blue, Firefox
  orange, Safari blue, Opera red, Brave orange, Android green, Linux amber,
  Apple gray) with a neutral gray fallback.
- Raster share images get a resized 300px WebP preview on first request
  (`?download=false&webp=300`, quality 82) cached under
  `uploads/_previews/v300/<shareId>/<fileId>.webp`. The backend checks the MIME
  type and size before opening a storage stream, keeps a short negative cache
  for unsupported formats (APNG/SVG/ICO and oversized files) and the gallery
  only requests WebP for convertible extensions. GIF is converted to a
  first-frame WebP for the gallery card; the full-size modal still serves the
  original animation. Preview caches from
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
  `/api/shares/sitemap` route is gone; the backend generates the crawl artifacts
  itself (now from disk, see the later cache pass) and no sitemap/robots rows or
  tables exist in SQLite.
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
- The SEO/performance pass was rechecked locally on Node `26.12.1` against a
  copy of `/home/rt/Documents/pingvin-share.db` (API on `:8080`, production
  `next start` on `:3000`). Guest and signed-in (`thuoct222026`) Playwright
  traversals of `/`, `/trending`, `/new`, `/share/:id`, `/privacy`, `/imprint`,
  `/auth/signIn`, `/404` and a missing route found one H1 per page, no missing
  image `alt`, valid canonical/robots/OG/Twitter tags, parseable JSON-LD, no
  horizontal overflow and no console warnings/errors (only the intentional 404
  network entry). Generated metadata examples: a folder upload titled
  `shortened — 6 files to download` with a description naming the first two
  videos, and a single PDF titled from its file name with size. `/new` painted
  24 cards from SSR HTML and exposed 50 crawlable share links; `/share/000`
  SSR metadata, breadcrumb JSON-LD and the preload link for the first WebP
  image were verified. Local LCP stayed below 300ms and the share-page CLS fell
  from ~0.177 to ~0.095 after reserving the footer country grid; the remaining
  shift is the intentional 5s empty-ad collapse. The share route first-load JS
  is ~316 kB (page JS ~16.3 kB) after lazy-loading the preview modal.
- A live client-navigation transition from `/` to `/new` or `/trending`
  initially failed with `Application error`. The cause was a CDN-cached empty
  `/_next/data/<buildId>/new.json` / `trending.json` response captured during
  deployment; the page then called `.slice` on `undefined`. The fix marks all
  Next data responses `no-store`, defaults `initialItems` to `[]`, guards the
  config helper, and keeps the client fetch fallback. A Playwright run that
  intercepted those data responses and returned `{}` still navigated to both
  pages with no error and loaded the listing from the client fallback.
- Ads are guest-only. `Ads` waits for the client session check and returns
  `null` when either `useUser()` has a user or the `access_token` cookie is
  present; the three publisher scripts are only appended for guests. Playwright
  verified the guest share page created all three ad requests, while the same
  page in a signed-in session made zero ad requests and rendered zero ad slots.
- Final live verification after the guest-only-ad and thumbnail-fallback
  deployment: the `/new` API returned 200 items and all 200 thumbnail requests
  were real WebP files (784 B–22.4 kB, median ~6.2 kB). Share C6ZZ now returns
  a 6.9 kB 169×300 video-frame WebP instead of the 72-byte placeholder. Guest
  `/share/tUGS` and `/404` each loaded all three ad scripts and rendered one
  ad slot; the same pages in the signed-in test session made zero ad requests
  and rendered zero ad slots. Desktop and mobile guest/signed audits covered
  the public, account, upload and admin pages with no application console
  errors/warnings (only the intentional 404 network entry), no missing image
  alt text, no overflow, valid JSON-LD and canonical/robots tags. Client
  navigation home → New → Trending → share, the lazy preview modal and the
  no-store `_next/data` responses were all verified. Cached HTML TTFB was
  ~0.04–0.6 s and cold SSR ~0.55–1.1 s; desktop LCP ~0.65–1.6 s, mobile
  ~0.12–1.03 s. Remaining CLS is limited to guest ad insertion/collapse on
  non-gallery share pages (~0.09–0.11) and the footer stats area on mobile
  sign-in (~0.10); the media share dropped to ~0.003.
- The live audit after the fix covered `/`, `/trending`, `/new`, three public
  shares, privacy, imprint, sign-in, 404, a missing URL, and signed-in
  upload/account/shared/received/reverse-share/admin pages at 1366px and
  390px. Every page had one H1, no missing image `alt`, valid canonical/robots
  metadata, parseable JSON-LD, no horizontal overflow, and no application
  console errors/warnings; only the intentional 404 network entry appeared.
  Guest and signed-in client transitions (home → New, home → Trending, New →
  share) completed without an error boundary. The lazy preview modal opened
  the full-size image from the gallery with no console errors. Cached HTML TTFB
  was ~0.04-0.6s; first uncached SSR responses were ~0.6-1.1s due to
  Cloudflare-to-origin latency. Desktop LCP was ~0.1-1.5s and mobile
  ~0.1-1.5s depending on cache state. `/share/tUGS` mobile CLS was 0.214
  before the action-slot fix and 0.003 in the delayed-API local rerun.
  Cloudflare still had stale empty `_next/data` entries at the edge, but the
  fallback rendered the listing with no error; a one-time purge of
  `_next/data/*` (or a cache rule that honors origin headers) removes the
  extra fallback request.
- A `/new` thumbnail scan of the live 200-item feed found one placeholder:
  share C6ZZ returned a 72-byte transparent WebP with
  `X-Thumbnail-Reason: image-failed`. Its first preview was a 1.6 MB BMP that
  the installed sharp build rejects (`Input file contains unsupported image
  format`), even though the share also contains MP4 videos. The new ordered
  fallback rebuilt the thumbnail from the second candidate. A local fixture
  (same BMP first, a valid MP4 second) now produces a 218-byte 300x225 WebP
  video-frame thumbnail instead of the placeholder.
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
  the widget server-side with twelve cards in a 4-column desktop grid, a
  3-column tablet grid, a 2-column small-tablet/mobile grid and a single column
  at 390px, with zero measured layout shift; the home and upload pages no
  longer render or request the widget. Preview thumbnails use a 6px blur and
  dark gradient; the image clears on hover, and each card shows the share name
  and description, file count, total size, upload date and view count with a
  play badge for videos. Dark mode was checked and click-through to
  `/share/<id>` was verified. The widget title links to the public `/trending`
  page, which renders the identical grid with up to 100 entries from
  `?limit=100`; full-page cards use a 2px preview blur, render in 24-card
  viewport batches, and the page is edge-cacheable as an anonymous shell.
- Trending card pass (2026-10-25): the Valkey metadata now also carries the
  whitespace-normalised, 240-character-capped description, file count and total
  size, and the API returns the upload date as well. The metadata is written
  once with `SET ... EX ... NX`, and a legacy entry is enriched from SQLite once
  on its first ranking read (then written back) so a deploy does not leave
  active cards without details. An isolated local database and a real
  Valkey-compatible server produced eight `pingvin:trending:meta:<shareId>`
  keys and one daily sorted set for eight test shares; the capped description
  was exactly 240 characters, each metadata TTL was eight days, and the
  `/api/shares/trending?limit=48` response had the expected name, description,
  file count, size, date, views and preview kind. A seeded legacy key with the
  old shape was backfilled by one SQLite lookup and rewritten with the new
  fields. Playwright covered guest and
  signed-in `/trending` and share/404 widgets at 1366, 1024 and 390px: the
  enriched cards rendered in 4/3/2/1 columns, images loaded via the WebP
  preview route, the preview used a 6px base blur with a dark gradient and
  cleared to `blur(0px) brightness(1)` on hover, the video play badge and view
  label were present, no card description exceeded two lines, hover,
  click-through, back navigation, dark mode and the edge-cache headers were
  correct, and there were no unexpected console errors or warnings. All
  backend unit tests and both production
  builds pass.
- Trending window pass (2026-10-25): the ranking window grew from seven to
  thirty days. `WINDOW_DAYS` now drives one thirty-day `ZUNIONSTORE` over the
  same per-day sorted sets, while the per-share metadata and daily buckets keep
  a thirty-one-day TTL so the newest day never falls out of the window. Shares
  created up to thirty days ago are eligible; shares older than that are still
  rejected before metadata is written and again when the ranking is read. The
  widget, share page, 404 page and `/trending` all use the same endpoint and
  now describe the window as "last 30 days" in the visible copy and SEO
  description. Locally, a public share created ten days ago appeared in
  `/api/shares/trending` while a thirty-five-day-old share did not, both cache
  TTLs measured 2,678,395 seconds (31 days), and the API kept its
  60-second edge cache headers. Playwright covered guest and signed-in
  home/share/widget/`/trending`/404 views at 1440px and 390px: cards rendered
  with WebP thumbnails, the copy no longer mentioned seven days, and the only
  console entry was Chromium's expected 404 for the missing document itself.
  The live 30-day deploy was then checked the same way: `/trending` returned 48
  cards, the share and 404 widgets returned 12, the "last 30 days" copy was
  present for guests and signed-in users, click-through and back navigation
  worked, mobile had no horizontal overflow, and the anonymous shell was an
  edge-cache `HIT` while 404s stayed `no-store`.
  The live API initially still omitted a public media share with 7,572 views
  because its last view predated the retired eight-day buckets. A one-time
  seed (`pingvin:trending:seed:<windowDays>`) now rebuilds the current day's
  scores and metadata from one SQLite query, so the complete 30-day list is
  available immediately instead of filling in as old shares are viewed again.
  In the seeded local run the 7,572-view share ranked second, a 20.9-day-old
  share was included, and Valkey held one views key, one seed marker and one
  metadata key per eligible share. All 95 backend unit tests and both
  production builds pass.
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
- Live NCQy download audit (2026-10-25, after deployment): with the non-admin
  account only, the public 10-file share showed `10 files · 7.9 KB` without the
  ZIP note. "Download all" opened the confirmation modal and produced all 10
  downloads; every generated file link had an explicit `download` attribute,
  no `/files/zip` request was made, and no extra tabs or page navigations
  appeared. A second run with browser downloads disabled also produced zero
  extra tabs and zero navigations, confirming that a denied/pending permission
  no longer reloads the share page. A real-ad load of the same page produced no
  console errors or warnings. `navigator.permissions.query` rejects
  `automatic-downloads`, `multiple-downloads`, and `downloads` in Chromium, so
  the UI cannot pre-check this browser setting.
- Admin logs capture is runtime-only: a process restart clears the memory
  fallback, and startup errors logged before `app.useLogger` are only in
  systemd's journal. On the live deployment the backend captures errors from
  that point forward into Valkey, so the viewer is intended for diagnostics
  rather than a complete journal replacement.
- Cache-footprint/write pass (2026-10-25): the generated sitemap was measured
  at **1,565,078 bytes** on the 15.9k-share local database and was stored as a
  single Valkey string (plus a memory copy). It is now written to the
  persistent data directory as an index plus 50k-entry chunks, with a
  content-hash `?v=` on every chunk URL, and served from disk (index read
  ~3 ms). The local 15,499-entry sitemap is one chunk; a 50,001-share unit
  fixture produced two files of exactly 50,000 and 3 entries. The rolling
  expiration is now persisted at most once per six hours per share/process
  while every response still shows the fresh 100-day date, and the page-view
  aggregate is cached for 30s instead of 10s. The backend production build and
  all 56 unit tests pass (new sitemap index/chunk/version-busting/50k-limit,
  robots, and expiration-throttle tests). A local Valkey 8.10 instance showed
  no `seo:` keys after sitemap and robots requests, and a chunk request
  returned the disk file with a one-day edge TTL. Removing the
  unused `getExpirationPreview` helper
  also dropped `moment` from the middleware/shared bundle: the production
  build's shared first-load JS fell from 252 kB to 233 kB and middleware from
  48.1 kB to 28.5 kB. The backend startup
  also passed after removing the redundant `AppCacheModule` import from the
  throttler factory.
- Fork-delta/query pass (2026-10-25): both production builds pass and all 84
  backend unit tests pass (new storage aggregate, concurrent share-load,
  concurrent ranking-read and atomic view-limit cases). An isolated copy of the
  local database and a locally built Valkey 9.0.0 confirmed:
  - guest and owner share responses both include `uploaderInfo.visitors`; the
    share page shows "Recent visitors" to every visitor;
  - a max-view share accepted exactly its two allowed views and the third
    returned `403 share_max_views_exceeded`, with the counter stored atomically;
  - the upload quota aggregate returned exactly the SQLite file-size total;
  - trending metadata was written once with `SET ... NX` (its TTL decreased
    instead of resetting on a second view), a public image share produced one
    `pingvin:trending:views:<day>`, one `pingvin:trending:meta:<id>` and one
    hourly geo hash, the temporary rank key was removed, and `/trending` plus
    the share widget rendered the card with zero console errors;
  - 90 requests with one IP + User-Agent were allowed and the next 5 returned
    `429`, with both throttle buckets present in Valkey;
  - stopping the backend made `/manifest.json`, `/robots.txt` and
    `/sitemap.xml` fall back with a 60-second CDN TTL instead of their normal
    day/hour TTL, and a share page returned `503` rather than a 200 noindex
    page. A malicious `?redirect=https://…` sign-in URL was rejected with a
    clean redirect to `/auth/signIn` and no reflected external target.
  A Playwright guest/owner pass covered home, trending, public/protected shares,
  privacy, imprint, sign-in, upload, account shares, admin redirects, the
  404 page and 390px mobile width; the file-list header now aligns with the
  name column, the recent-visitor list was visible to both guest and owner, and
  the browser console stayed clean.
- Live deployment pass (2026-10-25, after the update): the same checks were
  repeated against the live site with temporary QA shares, which were deleted
  afterwards (share pages returned 404). Guest and owner API responses both
  included `uploaderInfo.visitors`; the guest and owner pages both showed the
  "Recent visitors" list.
  Absolute, protocol-relative and backslash `?redirect=` values all returned a
  307 to a clean `/auth/signIn` with no reflected external target. A max-view
  share accepted exactly its three allowed sequential views and returned
  `403 share_max_views_exceeded` on the fourth; 20 concurrent requests against
  a fresh five-view share produced exactly 5 `200` and 15 `403`. A live UI
  upload produced a working share page, text preview loaded the plain text,
  copy placed the same text on the clipboard, and the uploaded QA share was
  deleted. Cache checks passed for anonymous HTML shells (60s), auth pages
  (`no-store`), config (30s), stats/trending/SEO (60s), manifest/robots (one
  day) and the sitemap index (one hour); public files carried a day-long
  immutable CDN policy, an ETag and no cookies. The live `/trending` page and
  share widget rendered cards, the sitemap index/chunk were valid, admin APIs
  returned 403 and admin pages redirected a non-admin to upload. Playwright
  covered guest, owner, 390px mobile and dark mode with no horizontal overflow
  and zero application console errors or warnings; a separate real-ad load
  also produced no console messages. No temporary QA shares remain.

- Admin-list/query pass (2026-10-25): the two numeric-string user quota
  columns (`storageQuotaLimit`, `shareSizeLimit`) are now ordered and paged in
  SQL instead of loading every user into process memory; unset quotas still
  sort last in both directions, and the admin table re-fetches the matching
  page. The user-delete path selects only `isAdmin` and share IDs instead of
  every share column. `/robots.txt` and `/sitemap.xml` now use the short
  60-second fallback TTL whenever the backend artifact request fails or returns
  an empty body, even when the config fetch itself succeeded (the previous
  check only looked at config fallback). Verified on an isolated 16k-share
  database with Valkey 9.1.2: asc/desc quota sorting returned 1/9/10 GB in the
  expected order through the real admin API and table UI, create-and-delete of
  a temporary user succeeded, normal sitemap/robots headers remained one
  hour/one day, and stopping only the backend produced 60-second fallback
  headers for both. A Playwright guest/admin/mobile pass covered home,
  trending, public shares, legal pages, sign-in, upload, account pages, all
  admin pages, 390px width and the 404 page with zero application console
  errors or warnings; an upload → share → WebP preview (300px) → file download
  → delete flow also passed with a clean console.
- VirusTotal large-upload auth fix (2026-10-25): the scanner paused with
  "API key rejected" because files above 32 MiB skipped the `x-apikey` header
  on VirusTotal's pre-signed large-upload URL; VirusTotal answered HTTP 401
  `AuthenticationRequiredError`, which the service treated as a bad key and
  stopped the worker. The large-upload request now sends `x-apikey`, and only a
  real HTTP 401 pauses scanning: a 403 `ForbiddenError` is recorded as a
  per-file operation error so one unsupported request cannot disable every
  later scan. A real 40 MiB upload against VirusTotal returned 200 and moved
  the job to analysis with `authFailed=false`; all 86 backend unit tests pass
  (new 401-pause, 403-continue and large-upload-header cases), both production
  builds pass, and the local admin dashboard showed "API key accepted" and
  "Worker running" at 1366px and 390px with zero console errors or warnings
  across guest, signed-in and admin pages.
- VirusTotal removal notices and permanent hashes (2026-10-25): confirmed
  malicious SHA-256 values are now appended to
  `DATA_DIRECTORY/virustotal/malicious-hashes.txt` and loaded on startup. A
  local share whose file hash was pre-seeded in that file was removed by the
  hash stage with `cached=true` and no new VirusTotal API call; the share
  returned 404 and its stored reason names VirusTotal. A mock SMTP server
  captured the uploader notice with the file name, share link and
  "share removed because no files remained" status, and the SMTP-disabled path
  silently skips the notice. The admin dashboard rendered the malicious event
  at 1366px with no console messages. All 93 backend unit tests pass (new
  permanent-ledger, repeat-hash, reverse-owner recipient, email and
  custom-reason cases), and both production builds pass.
- Live post-update audit (2026-10-25): after the large-upload fix was deployed,
  a Playwright pass covered the home, trending, sign-in, legal, public-share,
  upload, account, received and reverse-share pages as a guest and with the
  non-admin test account at 1366px, plus home/trending/upload/share at 390px.
  Every page had one H1 and no horizontal overflow; there were no console
  errors or warnings. `/admin` redirected the non-admin account to `/upload`.
  The admin dashboard itself was not opened live because the test account is
  non-admin.
- Live post-feature audit (2026-10-25): after the removal-notification and
  permanent-hash deployment, the guest/non-admin/mobile Playwright pass was
  repeated with zero console errors or warnings. A temporary public text share
  was created through the live API, rendered its file name, downloaded
  byte-identical content when requested with the app referrer, had no
  horizontal overflow at 390px, and was deleted; the share API then returned
  404. Text files are skipped by VirusTotal, so this smoke test consumed no
  scan quota. The admin dashboard and removal email were not exercised live
  because the test account is non-admin and no malicious file was uploaded to
  production.

- Lazy share sections and viewport-fit previews (2026-10-25): `TrendingToday`
  no longer blocks SSR on `/trending`, `/share/*` or `/404`; it starts its API
  request from an `IntersectionObserver` and renders the same grid skeleton
  while loading. The share page now wraps the media gallery, file list,
  comments and visitor insights in `LazySection` with dedicated skeletons, so
  comments are fetched only near the viewport and every section keeps its
  height while loading. The file preview modal is centered and constrained:
  a 1200x2000 portrait, a 2400x900 landscape, a 640x360 video and a text
  preview all fit inside 1366x768, 390x844 and 844x390 viewports with zero
  dialog or horizontal overflow. Guest, signed-in (test account), desktop and
  mobile Playwright runs covered `/trending`, `/share/*`, `/404`, lazy
  placeholders and all modal types with no application console errors or
  warnings; the only console entry was the expected 404 document status for
  the deliberately missing URL. A follow-up live mobile pass found that one
  instantaneous jump to the bottom could skip the visitor-insights placeholder
  on the way. `LazySection` and `TrendingToday` now observe with a
  `1000000px` top root margin so a section that jumps from below the viewport
  to above it still produces an intersection change; a local 390px and 1366px
  jump-to-bottom test with a 120000px spacer mounted visitor insights and
  comments correctly, while a no-scroll check left them unmounted. Backend and
  frontend production builds pass.
- Maintenance pass (2026-10-25, later): the duplicate per-share lock and
  temp-file write blocks moved into `keyedLock.util.ts` and
  `fileWrite.util.ts` (comments, visitor metadata, VirusTotal state), the last
  visitor snapshot is reused between views instead of re-reading
  `uploader.json`, an existing sitemap chunk is served without refreshing a
  stale manifest, and the share edit page now has a visible H1. Both
  production builds pass, all 107 backend unit tests pass (including new
  snapshot-reuse and sitemap-fast-path tests), and lint is clean apart from
  the known upstream `any` warnings. Playwright covered 24 guest, signed-in,
  admin, mobile and dark-mode pages with no application console errors or
  warnings, no page exceptions, no failed requests, no horizontal overflow and
  one H1 per page (robots/sitemap documents excluded). The share flow rendered
  the gallery and both file rows, created/edited/deleted a comment, showed the
  visitor list, and a burst of share views followed by `SIGTERM` persisted the
  unflushed visitors. The sitemap index/chunk retained its edge headers and a
  stale-manifest chunk request did not rewrite the files. Trending remains
  hidden in this sandbox because no Valkey server is installed; its backend
  ranking/cache behavior is covered by the unit tests.
- Live verification of that maintenance pass (2026-10-25): the deployed manifest
  version matched the pushed commit. A temporary public share with an image and
  a text file was created through the API, and Playwright covered 21 live routes
  as a guest, the test account, a non-admin admin redirect, mobile and dark
  mode. All pages had one H1 (robots/sitemap documents excluded), no horizontal
  overflow, no application console errors or warnings, no page exceptions and
  no failed application requests; lazy media loads canceled by scroll/close
  were recorded separately. The live share rendered the gallery, both file
  rows, the visitor list and 12 trending cards (`/trending` showed 48), a
  comment was created, edited and deleted, and the temporary share was removed
  (the subsequent API request returned 404). The home shell was a Cloudflare
  HIT; comments used the 30-day edge TTL, trending/SEO 60 seconds, the sitemap
  index one hour, chunks and robots one day, and the public file/preview kept
  an ETag with `CDN-Cache-Control: public, max-age=86400, immutable`. The live
  proxy rewrites browser `Cache-Control` for XML/TXT/file responses, so edge
  policy must be checked on `CDN-Cache-Control`/`Cloudflare-CDN-Cache-Control`.
- "New shares" (2026-10-25): both production builds pass, all 111 backend unit
  tests pass (recent listing filters/cap/cache and missing-file 404 included),
  and lint is clean. The local database copy (16k shares) returned 100 cards in
  ~31 ms cold; every item was public, unexpired and had a renderable preview,
  the list was ordered by upload date descending, and zero-view shares were
  included (14 of the 100). Guest
  and signed-in headers show New after Upload (guest: Home/New/Sign in), the
  footer link and mobile menu entry work, and 100 cards render at 1366px and
  390px with no overflow. The card for an image-only share showed the Image
  badge (no play icon); a share containing a video showed the play badge. The
  page had one H1, canonical `/new`, indexable robots, CollectionPage JSON-LD,
  the 60-second anonymous shell cache, and the 60-second endpoint edge cache.
  `/new` is in robots and the sitemap chunk. Clicking a card opens its share
  page. The local missing-media 404s are expected from the database-only copy;
  the backend now returns 404 for them instead of crashing.
- Live "New shares" verification (2026-10-25): the initial listing shipped as
  `2a71646b`, and the zero-view allowance as `eadea3ea`. On the final deploy
  `/api/shares/recent?limit=100` returned exactly 100 shares, all
  public/unexpired with a preview, correctly ordered by upload date, with 17
  zero-view shares included (the first card had 0 views), 13 image-only and 87
  video-bearing cards; the endpoint was a Cloudflare HIT with the 60-second edge
  TTL. The `/new` page rendered 100 cards as guest and mobile and as the test
  account, showed the Image badge without a play icon and the Video badge with
  one, kept the header order Upload→New (guest Home→New→Sign in), exposed the
  footer link and mobile menu entry, had no application console errors/warnings,
  page exceptions, failed requests or horizontal overflow, and clicked through
  to the share page. It had one H1, the `/new` canonical, indexable robots,
  CollectionPage JSON-LD, and was present in the sitemap chunk and robots allow
  list. The existing 21-route guest/user/mobile regression, comments and cleanup
  still passed (`2a71646b`).
- Upstream merge `v2.1.0-beta.1` (`9fbf6155`, `aeec7688`, `8ccf8f15`) resolved
  conflicts in `Header.tsx`, `404.tsx` and the custom home page by adopting
  upstream's `useHomeHref` redirect and keeping the fork-only ad slot and home
  content. Local `npm ci` plus both production builds pass. Playwright checked
  37 guest/signed-in routes at 1366px and 12 routes at 390px in dark mode with
  no application console errors, warnings, page exceptions, failed requests,
  horizontal overflow or status mismatches (third-party ad tags blocked;
  intentionally missing test-share media ignored). Home targets were also
  verified with `general.showHomePage=false` for both unauthenticated-share
  settings: guests land on `/auth/signIn` or `/upload` accordingly, signed-in
  users always land on `/upload`, and logo/404 links match each destination
  without a redirect loop.
- Image-heavy share fix (2026-10-25): file and ZIP reads now skip the
  visitor rate-limit bucket while keeping the dedicated 1200/min per-route
  file limit. Previously a 41-image share made ~76 file requests on one page
  load, consuming almost the whole 90/min visitor budget and making the next
  request in that minute return 429. Locally, five file GETs with one UA left
  the visitor bucket at 89 while a share GET still decremented it. The default
  `general.appName` is now `DropMB` in the seed, the bundled frontend fallback
  and `config.example.yaml`, so a fresh install or a config-fetch fallback
  never shows the upstream product name; an existing database value still
  wins.
- Upstream-alignment/optimization pass (2026-10-25): the public-share SQL
  predicate moved to `publicShareWhere()` and the creator/active predicate to
  `activeShareWhere()` in `backend/src/share/share.util.ts`, so the recent
  listing, sitemap builder, share-limit checks and account listing share one
  definition. `getRecent` now returns the preview and the `hasVideo` badge from
  a single MIME pass, `GET /api/shares/:id/metaData` reuses the guard cache
  instead of loading the share (and its comments file) a second time, the
  comment-version read runs in parallel with the throttled expiration update,
  and admin config batches validate from the in-memory config and reload the
  table once instead of running a find/update/full reload per variable. The
  VirusTotal audit prunes at most once per minute and writes compact JSON.
  Frontend: `hooks/siteMeta.hook.ts`, `DEFAULT_SITE_NAME` and
  `buildWebsiteRef` / `buildCollectionPage` in `utils/seo.util.ts` replace the
  site-name and `isPartOf` copies on every page; the share edit/report modals
  load through `import()` (share page first-load JS 367 kB -> 319 kB); the
  restricted and missing-share screens share one `ShareMessage`, and every
  "go home" target (breadcrumb, error screen, error modal, delete redirect)
  uses `useHomeHref`. A transient share SEO failure now returns a `no-store`
  503 instead of a CDN-cacheable error, the anonymous shell only varies on
  `Accept-Language` when `general.defaultLanguage` is unset, and the dynamic
  manifest reuses the shared config helpers. Verified locally with both
  production builds, all 111 backend unit tests, clean frontend lint and 28
  Playwright routes (guest, admin, 1366px and 390px dark) with zero application
  console errors/warnings; the recent and trending APIs, sitemap index/chunk,
  config batch save, `metaData`, visitor/comment persistence, cache headers and
  the offline-share 503 `no-store` response were checked directly.
- Live verification of that pass (2026-10-25): the deployed manifest version
  matched the pushed commit. A temporary public share with a PNG and a text
  file was created through the API and checked as a guest, the test account and
  at 390px in dark mode: the page returned 200, rendered one H1, indexable
  robots and CollectionPage JSON-LD, loaded a 300px WebP preview (3.1 kB) and
  served the text file as an attachment with an ETag and the day-long
  immutable CDN policy; the download-all and report dialogs opened, the
  lazily-loaded edit form opened for the owner, a comment was posted and read
  back with the bumped version, visitors and views were recorded, and the
  missing-share go-home target became `/upload` after the client session
  hydrated. The temporary share was deleted; its API and SEO routes returned
  404 immediately, the cached page shell returned 404 after its 60-second TTL,
  and it disappeared from recent, trending and the country lists. A 10-route
  guest pass (home, trending, new, imprint, privacy, image/video shares,
  sign-in, missing share, unknown route) and a signed-in pass (upload, account
  pages, share page, missing share) had one H1 each, no horizontal overflow,
  no images without alt, and no application console errors or warnings; the
  non-admin `/admin` request redirected to `/upload`. `/new` rendered 100
  cards (14 image / 89 video badges) and `/trending` 48 cards with five
  country tabs; the share and 404 widgets showed 12 trending cards. The
  footer showed the live overview and eight countries, and `/manifest.json`
  named the site with 16 icons. Cache checks: anonymous home/new/share shells
  were Cloudflare `HIT`/`REVALIDATED` with the 60-second policy and
  `Vary: Accept-Encoding`; configs 30 seconds; trending/recent 60 seconds;
  share SEO 60 seconds; the sitemap index one hour; the 15,660-URL chunk,
  robots and manifest one day (`HIT`); public comments 30 days; public
  file/preview responses kept their ETags and no `Set-Cookie`; `/api/system/stats`
  was edge-cacheable and the page-view POST stayed `no-store`. The known stale
  duplicate `no-store` header on `/api/configs` from the CDN copy remains and
  does not affect the body.

## UI loading, dates, lazy media and listing limits (2026-10-26)

- A global `RouteProgress` bar is mounted in `_app` and listens to Next router
  and hash events. It appears for every client-side navigation, keeps a
  200 ms minimum visible time so prefetched routes do not flash, and then
  completes and fades. It is a fixed 3 px Mantine `Progress` bar and does not
  change page layout or request data.
- `RelativeTime` renders every user-facing timestamp as a localized relative
  value ("a few minutes ago", "in 6 days") with the full localized date and
  time (`LL · LTS`) in a tooltip. One module-level 30-second ticker updates all
  instances on a page. It is used by trending/new cards, comments, visitor
  rows, uploader metadata, share information/expiry, account tables, admin
  share tables, the VirusTotal event/status panel and the log refresh label.
  Raw copied log lines keep their exact millisecond timestamp for debugging.
- Listing thumbnails use the requested blur levels: 4px on the share and 404
  widgets, 2px on `/trending` and `/new`. Top-country thumbnails are 2px and
  clear on row hover/focus. The blur is applied in CSS and reversed on hover
  with the existing brightness/scale treatment.
- The shared `HoverTip` uses an instant transition so adjacent tooltips (for
  example the uploader country, OS and browser badges) cannot cross-fade over
  each other while the pointer moves between targets. The country tooltip still
  shows the location, timezone and relative/full upload time.
- `TrendingToday` now requests up to 100 trending shares and up to 200 recent
  shares. Only 24 cards are mounted initially; an `IntersectionObserver` with a
  200px margin reveals the next 24-card batch and shows four skeleton
  placeholders below the current grid. Images use `LazyImage` (native lazy
  loading plus a shimmer placeholder), videos still use `LazyVideo`, and the
  existing `LazySection` continues to defer share galleries, file lists,
  comments and visitor insights. `getRecent` returns at most 200 items and each
  country panel still holds at most ten shares; the country list is capped at
  ten countries. The top-country tabs are compact flag-only buttons with a
  shortened compact view count (`10.4K`, `980`); the full country name is in a
  tooltip and the tab's accessible label. The tab row is 32px high, and panel
  rows/counts use tighter spacing and compact numbers (`2.1K views`).
- Verified locally with both production builds, all 112 backend unit tests,
  clean frontend lint and a Playwright pass over guest and signed-in routes.
  The pass confirmed the navigation bar, relative timestamps and full-date
  tooltips, 2px/4px preview blur, 2px country blur with hover clearing,
  24-card lazy batches on `/new`, the requested `limit=200`/`limit=100`
  requests, relative dates in the admin share table, and zero unexpected
  console errors or warnings. Chromium's expected document-status log for a
  direct `/404` visit is the only filtered entry.

## Share-level listing and OG thumbnails (2026-10-26)

- Every completed share with at least one image or video gets one 300px WebP
  at `DATA_DIRECTORY/uploads/_thumbnails/v300/<shareId>.webp`. This single
  asset is used by all four listing surfaces (share widget, 404 widget,
  `/trending` and `/new`) and by the share page's Open Graph/Twitter image.
- Generation is queued in the background from `share.complete`. The listing
  controllers (`/api/shares/trending`, `/api/shares/trending/countries` and
  `/api/shares/recent`) also warm the first 48 missing thumbnails after reading
  the list, so the first two lazy card batches usually find the file already
  present. The rest are generated on demand as the visitor scrolls; a
  three-worker queue plus per-share in-flight promises coalesce card bursts
  into one job per share without starting hundreds of ffmpeg jobs at once.
- Image shares reuse the existing per-file 300px WebP: the share thumbnail is
  a hardlink when possible (copy fallback), so a share with an image does not
  pay for a second image decode. JPEG, PNG, WebP, GIF, BMP, TIFF and AVIF
  sources are supported. `getPreviewCandidates` now supplies up to five
  ordered fallbacks (the normal `findPreview` choice first, then the next
  image/playable video). A corrupt/unsupported BMP that sharp cannot decode
  therefore falls through to the share's video instead of leaving the listing
  card blank; the failed candidate is logged and the rebuilt thumbnail is
  cached normally. Video-only shares extract a frame with `ffmpeg`
  (`FFMPEG_PATH` first, then `ffmpeg` on PATH; a manually installed
  `ffmpeg-static` is also supported). A full build with H.264/MPEG-TS support
  is required for video thumbnails; `ffprobe` is not used. The frame is then
  resized with sharp. MPEG-TS/M2TS and other extensionless stored files get an explicit
  demuxer hint; the extractor tries input seeks, an accurate output seek and a
  plain first frame, and accepts a non-empty frame even when ffmpeg exits
  non-zero. If the local origin file is missing or cannot be decoded, ffmpeg
  retries the public edge copy with a browser user agent and matching referer.
  A genuinely unsupported/corrupt source gets a no-store transparent 1x1 WebP
  placeholder instead of a browser 404; the placeholder carries a safe
  `X-Thumbnail-Reason` diagnostic header (`no-media`, `video-local-failed`,
  `video-http-failed`, `video-timeout`, etc.).
- Listings now always render an `<img>` from the share thumbnail endpoint.
  They no longer create `<video>` elements, so a 200-card `/new` page does not
  download video metadata/first frames. The media badge/play overlay still
  comes from `previewKind`/`hasVideo`; gallery and file-preview modals keep
  using `LazyVideo` for actual playback.
- Thumbnail URLs carry `?v=<share.updatedAt>` and are served with a one-day
  public immutable cache plus an ETag for public shares; protected shares are
  `private`. File removal bumps `updatedAt`, deletes the thumbnail, and forces
  regeneration. Delete/revert-complete/expire paths also remove it.
- A daily 03:00 cron calls `cleanupShareThumbnails`, deleting `.webp` files
  older than 32 days; the same cleanup runs once at boot. Cleanup is
  self-healing because the next listing/OG request regenerates a missing
  thumbnail.
- `GET /api/shares/:id/seo` now returns a versioned `thumbnailUrl` whenever
  the share has a usable media source. The share page passes it to `Meta` as
  `og:image`/`twitter:image` with `image/webp`; if there is no media the
  default 1200x630 site image remains. The endpoint schedules the build in the
  background so SSR never waits on ffmpeg.

## Listing deduplication and cache-churn hardening (2026-10-26)

- The compact counter formatter is shared through
  `frontend/src/utils/number.util.ts` (`getCompactNumberFormat`), so the footer
  and the trending country tabs reuse one cached `Intl.NumberFormat` per locale
  instead of allocating one in each component. Both surfaces show the same
  `10.4K` / `980` values.
- The listing thumbnail fallback is one helper
  (`handleShareThumbnailError` in `frontend/src/utils/file.util.ts`). Trending,
  new and country cards fall back to the WebP logo once and hide the image if it
  is still unavailable, instead of repeating the same error handler in every
  card component.
- `MediaPreviewGallery` keeps the media kind it already resolved when sorting
  and reuses it for rendering, so each file is MIME/codec checked once per page
  render.
- Country panels inspect up to 30 ranked shares per country and up to 20
  countries before trimming to the public ten shares/ten countries. Deleted or
  expired high-view shares can leave scores without metadata until their daily
  buckets expire; the extra candidates keep the panel full without writing any
  extra Valkey keys. The normal path still uses one `MGET` for metadata.
- Verified locally with Node `26.12.1`: both production builds pass, all 117
  backend unit tests pass (including a new country-candidate regression test),
  frontend lint is clean and backend lint reports only the upstream `any`
  warnings. Playwright covered home, `/new`, `/trending`, a public share,
  privacy/imprint, sign-in, the 404 page, robots/sitemap/manifest, the signed-in
  upload/account/share/new/trending pages and a 390px pass with zero unexpected
  console errors, warnings, page exceptions or failed application requests.
  A fixture-backed country test rendered the compact `🇵🇭10.4K` / `🇺🇸980`
  tabs with the full name in the tooltip and the expected panel rows; a missing
  thumbnail fell back to `/img/logo.webp`. The signed-in share page opened the
  owner edit page, opened the report dialog, downloaded the file, and created
  and deleted a comment. Cache headers still matched the documented policies
  (config 30s, stats/recent/SEO 60s, sitemap index one hour, robots and share
  thumbnails one day, public files immutable for a day, page shells 60s only
  without a query string).

## Media gallery scale and preview navigation (2026-10-26)

- The share gallery now renders at most 100 images/videos (up from 30). Only
  the first 12 cards mount initially; an `IntersectionObserver` reveals the next
  12 when the sentinel approaches the viewport, and the sentinel shows a
  skeleton card so the next row is reserved. Images keep native lazy loading and
  the shimmer placeholder; videos keep `LazyVideo` and add a skeleton behind the
  frame until `loadeddata`. A 105-image + 3-video local share measured 12 cards
  initially and stopped at exactly 100, with the remaining media still available
  in the popup.
- `getShareMediaFiles` in `frontend/src/utils/media.util.ts` is the single media
  filter/sort used by the gallery: images first, then videos, each alphabetical
  with numeric filename ordering. The share page still reserves the first
  gallery batch only, so the initial skeleton is not heavier than the content.
- The file preview modal (`showFilePreviewModal` + `FilePreview.tsx`) accepts an
  optional media sequence and renders the active file name, a `current of total`
  counter, and previous/next buttons over the media. The buttons wrap around at
  the ends, and ArrowLeft/ArrowRight do the same unless focus is inside an input,
  textarea, contenteditable, video or audio element (preserving native media
  controls). Gallery previews pass all share media, including items beyond the
  100-card gallery cap; file-list previews pass the current table order. Text,
  PDF and audio previews opened from the file list keep the single-file modal.
  The modal title is the translated "Preview"; the active file name and counter
  are inside the body and the counter is `aria-live`.
- New fork-only translation keys:
  `share.modal.file-preview.custom.previous`, `.next` and `.position`.
- Verified locally with Node `26.12.1`: both production builds pass, frontend
  lint is clean, and Playwright on a 108-media share confirmed the 12-card start,
  100-card cap, skeleton sentinel, first/next/previous names and counters
  (`1 of 108` -> `2 of 108`), ArrowLeft/ArrowRight navigation, wrap-around from
  the last media to the first, a video share with animated skeleton cards that
  disappear after `loadeddata`, and no console errors or horizontal overflow at
  1366px or 390px. The video preview loaded lazily with
  `preload="metadata"` only after entering the viewport.

## Upstream sync and maintenance pass (2026-10-27)

- Merged `upstream/main` (`098aeae2`, `4a44bd35`, `3e853971`) and adopted the
  upstream clipboard-paste hook plus the shared `getFilesFromEvent`,
  `traverseDirectory` and `validateAndFilterFiles` helpers. The fork's old
  paste listener and its copies of the folder traversal/drop helpers were
  removed; only the per-file `share.maxFileSize` guard, the folder button and
  the fork dropzone copy remain. The upstream mobile description helper was
  corrected to use the mobile translation keys instead of the desktop ones.
- The imprint and privacy pages now share
  `frontend/src/components/legal/LegalDocument.tsx` for the title, metadata and
  markdown styling. Their route bundles dropped from about 8.6 kB to 1.6 kB
  each, and both pages keep one H1 and the canonical/JSON-LD metadata.
- Edge/query pass: `GET /api/oauth/available` now carries a 30-second edge TTL
  and skips the visitor bucket, so the sign-in and account pages no longer hit
  the backend for provider availability. The public reverse-share payload is
  read in one query and selects only DTO fields (no creator/account columns),
  and reverse-share creation validates and loads the token in one query with
  only the owner id/quota. `isValid` now selects just the expiration and
  remaining-uses columns; it runs on every reverse-share upload chunk.
  `GET /api/shares/:id/seo` samples up to 50 file names to find a preview
  instead of 20, while the background thumbnail warmup scans the thumbnail
  directory at most once per 30-second listing window. The thumbnail failure
  reason cache is capped at 1000 entries like the miss cache.
- Security hardening: both Next.js and Express no longer send `X-Powered-By`.
  Next sends `X-Content-Type-Options: nosniff` for every route; the Angie h5bp
  include owns `X-Frame-Options` and `Referrer-Policy`, so the app does not send
  duplicate copies. The bundled site-name fallback now matches the `DropMB` seed
  value.
- Verified locally with Node `26.12.1`, the local 16k-share database and no
  Valkey: both production builds pass, all 119 backend unit tests pass, frontend
  lint is clean and backend lint reports only the upstream `any` warnings. A
  Playwright pass covered the home, new, trending, legal, sign-in, public share,
  missing page, robots, sitemap and manifest pages as a guest; the upload,
  account, share, new and trending pages as the non-admin test account; and
  home/new/trending/privacy/share/upload at 390px in dark mode. Every page had
  one H1 and no horizontal overflow, with zero application console errors,
  warnings, page exceptions or failed application requests. A synthetic text
  paste on `/upload` produced one file row and the per-file size hint. A real
  text upload completed, rendered its share page and was deleted; a reverse
  share created through the API loaded as a guest, accepted an upload, and was
  deleted together with its share. Cache headers were checked on the HTML
  shells (60 seconds), legal pages, `oauth/available` (30 seconds),
  robots/sitemap/manifest and the backend `no-store` default. The new
  `X-Powered-By` removal and security headers were confirmed with `curl`.

### Live verification (2026-10-27)

- The deployed HTML included the pushed commit hash `d6f8552c`, so the update
  served the exact code from this pass. The dynamic manifest still reported
  `DropMB` and 16 icons, and the imprint/privacy pages kept their canonical
  URLs and `DropMB` descriptions.
- Header pass: `X-Powered-By` was absent from both the Next HTML and backend
  API responses. Anonymous page shells, legal pages and share pages kept the
  60-second edge policy; `/auth/signIn` and all redirects were `no-store`;
  `/api/configs` and the new `/api/oauth/available` cache were 30 seconds
  (OAuth showed a Cloudflare `HIT`); stats, recent, trending and share SEO were
  60 seconds; comments were 30 days; the sitemap index was one hour; its chunk,
  robots and the manifest were one day; public files and thumbnails had a
  day-long immutable `CDN-Cache-Control` plus ETags and no `Set-Cookie`; the
  share API, metadata endpoint and `HEAD` remained `no-store`. The live proxy
  rewrites browser `Cache-Control` for XML/TXT/file responses, so the edge
  policy was verified on `CDN-Cache-Control` as documented above.
- Guest/signed-in/mobile Playwright pass: 32 routes plus focused share checks
  covered home, new, trending, legal, sign-in, 404, public share, short link,
  robots, sitemap, manifest, upload, all account pages, admin redirects and
  390px dark mode. Every page had one H1 and no horizontal overflow; there were
  zero application console errors, warnings, page exceptions or failed
  application requests. The non-admin account was redirected from `/admin` to
  `/upload`, and both `/api/admin/virustotal` and `/api/shares/all` returned
  `403`.
- Upload/paste pass: a two-file image+text share and a 22-file
  (21 documents + one image named last) share completed through the live UI.
  The synthetic text paste produced one file row and the per-file size hint.
  The two-file share downloaded the text file with the original bytes and
  deleted with a subsequent `404`. The 22-file share returned
  `thumbnailUrl` and served a WebP `og:image` despite the only image sorting
  after the first 20 files, verifying the 50-file SEO preview sample. All
  temporary shares were deleted.
- Reverse-share pass: the API created a reverse share, the new public payload
  returned only DTO fields (no creator/account columns), a guest opened
  `/upload/<token>`, uploaded, completed and rendered the resulting share, and
  the owner deleted the reverse share. Its share returned `404` afterwards.
  Invalid tokens returned `404`.
- Redirect hardening: absolute, protocol-relative and encoded-backslash
  `?redirect=` values returned a clean `307` to `/auth/signIn` with no external
  `Location`. The sitemap chunk (15,742 URLs) contained `/new`, `/trending` and
  current public shares; the robots file allowed `/new` and the versioned
  thumbnail path.

### Label/header cleanup (2026-10-27)

- The share stats heading now reads "Recent visitors" instead of "Visitor
  insights".
- The visible "ADVERTISEMENT" label above the gallery ad slot was removed; the
  slot keeps its `aria-label` for assistive technology and the empty-slot
  collapse/observer logic is unchanged.
- Next no longer sends `X-Frame-Options` or `Referrer-Policy`, because the Angie
  h5bp include already sets both and the two sources produced duplicate
  identical headers. `X-Content-Type-Options` remains app-level; the edge keeps
  sending the other two exactly once.
- Verified live on commit `3d24f326`: `X-Frame-Options`,
  `Referrer-Policy` and `X-Content-Type-Options` each appear exactly once on
  HTML pages and `X-Powered-By` is absent. A share page shows "Recent
  visitors" (not "Visitor insights"), has no visible "ADVERTISEMENT" text, and
  still renders the guest ad slot with its `aria-label`. The 32-route
  guest/owner/mobile pass, upload, download, reverse-share and console checks
  all passed with zero application console errors, page exceptions or failed
  requests.
- The only duplicate left is the pre-existing stale Cloudflare copy of
  `Cache-Control: no-store` on `/api/configs` and `/api/oauth/available`.
  Cache-busting requests to those endpoints return a single correct public
  header from the origin; purging the two cached URLs clears the stale copy.

### Auth/query/cache pass (2026-10-27)

- Public share reads no longer authenticate. `ShareSecurityGuard` returns
  immediately for a public, unexpired `GET` (share payload, comments,
  metadata), and `FileSecurityGuard` does the same for public, unexpired file
  and preview requests without a share token. A signed-in visitor previously
  made the JWT strategy load a refresh token plus its user row for every
  request; a share page with dozens of previews produced dozens of those
  queries. Comment mutations still authenticate, protected shares still run the
  full token/password/recipient checks, and an expired share still falls
  through to the admin check before returning 404.
- `share.complete` selects only the columns the completion flow uses (file
  id/name/size, recipient id/email, creator allow/share/quota fields and the
  reverse-share notification flag/creator identity) instead of loading every
  user, file and reverse-share column. A missing share now returns 404 instead
  of dereferencing `null`. `sendMailToShareRecipients` accepts that narrower
  creator shape.
- Cron reads select only ids: expired shares, expired reverse shares,
  unfinished shares and unactivated users (with their share ids). The
  temporary-file cleanup tolerates a fresh data directory and a share
  directory removed mid-scan, and uses `rmSync(..., { force: true })`, so a
  fresh install no longer logs the daily `ENOENT`.
- The frontend's public `/api/configs` and `/api/oauth/available` requests
  carry the build hash (`?v=COMMIT_HASH`). `frontend/src/utils/version.util.ts`
  is shared by SSR/middleware, the client config refresh and the sign-in OAuth
  probe. A deployment therefore gets a fresh edge key instead of inheriting
  the stale duplicate `Cache-Control: no-store` copy that Cloudflare kept for
  the unversioned URLs; the origin headers are unchanged (30-second edge TTL).
- Verified locally with Node `26.12.1`: both production builds pass, all 119
  backend unit tests pass, frontend lint is clean and backend lint reports only
  the upstream `any` warnings. A direct `complete()` upload through the API
  succeeded, the edit cache invalidated correctly, and a password-protected
  share still returned 403 without a token and 200 with the correct token for
  both the share and file routes. Public file/preview responses kept the
  day-long immutable cache headers and ETag with no `Set-Cookie`; comments
  stayed at 30 days; the share API stayed `no-store`. Playwright covered 28
  guest, signed-in and 390px dark-mode routes plus the share gallery and
  download action with zero application console errors, warnings, page
  exceptions, failed requests or horizontal overflow. The temporary shares
  were deleted and both API and SEO routes returned 404 afterwards.

#### Live verification

- The deployed manifest/build markers reported `3e08c479`. The cached home
  HTML switched from the previous build to `3e08c479` after its 60-second TTL;
  a cache-busted home request returned the same build immediately.
- A temporary two-file share was created through the live API, completed,
  rendered its 300px WebP thumbnail/gallery, downloaded the text file with the
  original bytes, accepted a comment (then deleted it), opened its owner edit
  page, and returned 404 from the share and SEO APIs after deletion.
- Playwright covered 28 guest, signed-in and 390px dark-mode routes plus a
  separate guest mobile pass. Every page returned the expected status, had one
  H1 (documents excluded), no horizontal overflow and no images without alt.
  There were zero application console errors/warnings, page exceptions or
  failed application requests. The only console entries with ads enabled came
  from the third-party ad vendors.
- Security headers are each present exactly once: `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy` and HSTS; `X-Powered-By` is absent.
  Public page shells, share SEO, comments, files, thumbnails, stats, recent,
  trending, robots, the sitemap index/chunk and the manifest all returned their
  documented `CDN-Cache-Control` policies; public files kept an ETag and no
  `Set-Cookie`. Robots lists `/new` and the sitemap; the sitemap index points
  at one 15,745-URL chunk containing `/new` and `/trending`; the manifest names
  `DropMB` with 16 icons.
- Edge header observation: fresh (`MISS`/`BYPASS`) responses have one correct
  `Cache-Control`. Cloudflare serves an extra `Cache-Control: no-store` beside
  the public value on cached `HIT`/`REVALIDATED` responses for `/`,
  `/api/configs?v=...` and `/api/oauth/available?v=...`. `CDN-Cache-Control`
  remains correct and edge caching works; the origin (verified locally and via
  cache-busted requests) emits a single header. Purging those URLs or reviewing
  the edge Cache/Transform rule removes the duplicate. The versioned config and
  provider URLs still give each deployment a fresh origin read, but they do not
  prevent the edge from adding the extra header once the response is cached.
- Comments are versioned by the app (`?v=<commentsVersion>&page=N`); the
  versioned URL refreshes immediately after a mutation. A request that omits
  `v` can be served from a 30-day edge copy, so clients and tooling should keep
  the version parameter. Purging `/api/shares/*/comments` clears old
  unversioned copies.

## Maintenance pass (2026-10-27, second)

- `ShareTokenSecurity` reuses `ShareStateService.getGuardShare()` instead of
  running its own SQLite read, so the share page's `403 -> token -> retry` flow
  does not query the same share twice. The guard still rejects expired shares,
  and now also rejects incomplete/removed shares that have no guard entry.
- Share token cookies set `SameSite=Lax` and inherit
  `security.secureCookies`, and malformed/legacy share cookies are ignored while
  clearing old tokens. A garbage `share_<id>_token` cookie can no longer make
  `POST /api/shares/:id/token` fail. Tokens for never-expiring shares (no `exp`
  claim) are kept rather than treated as expired.
- A share with `commentsVersion === 0` no longer requests its empty comment
  listing; the section renders straight from the share payload, and the first
  real comment still loads through the versioned endpoint.
- PDF previews render in a modal iframe instead of navigating the current page
  to the file URL. Unsupported preview types render the fallback directly rather
  than updating parent state during render.
- Deleting a file or share waits for an in-flight WebP preview conversion
  before removing the preview cache, so a late conversion cannot recreate a
  preview after deletion.
- `_app` uses `router.pathname` for the admin-config layout exception and no
  longer carries a duplicate `route` prop/state.
- Removed handled S3 upload fallback `console.warn`/`console.error` calls, so a
  failed direct-upload probe or abort does not add browser console noise.
- VirusTotal archive detection: `backend/src/virustotal/archiveEncryption.util.ts`
  checks ZIP central/local headers, 7z coder metadata and RAR4/RAR5 block
  headers before a scan job is queued. Encrypted archives are recorded as
  `skipped` with no queue entry or API call. Tests use synthetic ZIP, 7z, RAR4
  and RAR5 headers; the same detector was also checked against libarchive's
  encrypted ZIP, 7z, RAR4 and RAR5 samples. A real completed upload of an
  encrypted ZIP produced the skipped audit event with zero API calls.
- Verified locally with Node `26.12.1`: backend build and all 122 unit tests
  pass; frontend production build and lint pass. Playwright covered 29 guest,
  member and 390px dark-mode routes, a public share (text/image/PDF, gallery,
  PDF iframe, comments), a password-protected share (wrong/correct token and
  file access), the malformed-cookie token path and admin API boundaries. There
  were no application console errors/warnings, page exceptions, failed
  requests, horizontal overflow or missing image `alt` attributes. Cache
  headers remained as documented; share token cookies carried `SameSite=Lax`
  and `HttpOnly`.

## Optimization and hardening pass (2026-10-27, third)

### Backend

- Unlimited share views are counted in memory and written in one batch every
  five seconds (`shareState.service.ts`, `VIEW_WRITE_DELAY_MS`). The response
  still returns the live count, the base counter is read once per share, the
  value returned by SQLite replaces the optimistic base after each flush, and
  shutdown flushes pending counts. Shares with `maxViews` keep the existing
  conditional `UPDATE ... RETURNING` path, so their limit stays atomic. Editing
  or deleting a share flushes and clears its counter first.
- Share data, guard and SEO cache fills are generation-checked. A per-share
  epoch is bumped by `invalidateShareDataCache()`, and a fill that started
  before the bump is either skipped or deleted immediately after its write
  (`setCachedValueIfCurrent()` in `utils/cache.util.ts`). This closes the race
  where a late read could restore a pre-password/pre-expiry share object.
- Public SEO payloads are cached for 60 seconds under `share:seo:<id>`, with the
  same invalidation path as the share data and guard entries. `getSeo()` now
  normally costs one cache read instead of a share query, a size aggregate and
  a thumbnail `stat()`.
- Public files, WebP previews and share thumbnails honor `If-None-Match` and
  return `304` instead of re-streaming an unchanged body. Range requests keep
  working on the full response; S3 presigning no longer re-queries the storage
  provider and only fetches the file name when a download notification is sent.
- Reverse-share uses are reserved atomically with a conditional
  `updateMany` at share creation, not at completion. `revertComplete()` no
  longer refunds a use, invalid/exhausted cookies are rejected instead of
  falling back to a normal anonymous share, and concurrent creates can no
  longer exceed `maxUseCount`.
- Upload-init/complete/abort bodies now use class-validator DTOs. File names
  reject absolute paths, `..` segments, backslashes and control characters;
  `totalChunks` and `parts` are bounded, and the service also caps chunk count
  against `share.maxFileSize` / `share.chunkSize` before signing S3 URLs.
- Recipient notification emails are sent after the completion response with a
  bounded recipient list (100) and per-recipient error logging. HTML email
  templates escape user-controlled values; report and malware templates use
  the same escaping. Reverse-share recipient rows select only public user
  fields.
- OAuth token logging no longer prints raw provider tokens or callback
  `code`/`state` values, and a malformed `config.yaml` logs a generic message
  instead of the parser payload. Client error logs strip terminal control
  characters and are limited to 10 reports per minute.
- The thumbnail conversion queue is capped (200 pending) and sharp rejects
  images above 64 megapixels. ClamAV scans now load file rows once and reuse
  them for local and S3 shares instead of listing directories synchronously
  and querying each name.
- The expired-share cron has an in-flight guard, and the daily temporary-file
  scan uses `fs.promises` instead of blocking the event loop. The sitemap
  manifest is validated in memory for its 10-minute window, and `/health` uses
  a constant SQL probe instead of loading the config table.
- Cloudflare city/region/timezone headers are trimmed, stripped of control
  characters and capped at 64 code points before they reach `uploader.json`.
- Comment edge caching changed from 30 days to 24 hours. The versioned comment
  URL still refreshes immediately after a mutation; the shorter ceiling only
  bounds how long an old versioned copy can be requested.

### Frontend

- Page handlers no longer overwrite the middleware's cache decision:
  `setPublicCacheHeaders()` leaves an existing `Cache-Control` untouched. A
  non-default language/theme, query string or signed-in session now stays
  `no-store` on `/new`, `/trending` and `/share/*` instead of being turned back
  into a publicly cacheable localized shell.
- `/s/:shareId` is a static Next redirect, so the common short link no longer
  renders a page/SSR/middleware only to return the same 308. The redirect
  preserves the query string.
- The service worker precaches only the core bundles/page chunks and excludes
  replaceable logo/icon/OG assets, cutting the install download from roughly
  5 MB to the core build. Runtime navigation remains NetworkOnly.
- Uploads stop after three retries per file instead of restarting forever.
  `/upload` loads the create/completed modals (yup, moment, QR) on demand,
  reducing its first-load JS from about 364 kB to 283 kB.
- Share file lists reveal 50 rows at a time on scroll, matching the gallery and
  trending batching pattern. Footer stats keep their previous numbers while a
  new page view is recorded and ignore hash-only changes.
- The password modal shows its inline error and no longer stacks a second modal
  on a wrong/empty submission. Protected shares do not mount the ad slot;
  ads also stay disabled while a reverse-share cookie is active.
- Reverse-share boolean cookies are compared to the string `"false"` (instead
  of being coerced as truthy), language/theme controls initialize after
  hydration, QR codes scale inside narrow modals, and the sign-out path no
  longer depends on `URL.canParse`. `jose` was removed from the client bundle
  in favor of the existing `jwt-decode`.
- Share H1/breadcrumbs use the full owner-provided name; only the meta title is
  shortened. JSON-LD `numberOfItems` matches the emitted file entries. Auth
  verification/reset pages and the admin config page now render a single H1,
  and the error page builds its translation values correctly.
- `.dockerignore` now excludes `.env` and `*.log` from the build context.

### Verification (2026-10-27, third)

- Node `26.12.1`: backend build, all 128 unit tests and backend lint pass
  (14 upstream warnings only). Frontend production build and lint pass.
- API checks: three share views returned 1/2/3 while SQLite stayed at 0 and
  reached 3 after the flush; 20 concurrent views produced 20 unique counts and
  the final database value matched. SEO cache returned the old name until an
  edit, then the new name. Reverse-share tests returned `201` for the first
  create, `400` after revert, and `[201, 400]` for two concurrent creates with
  one use. Upload-init rejected a huge chunk count, a traversal name, a
  backslash name and an absolute path with `400`.
- HTTP checks: `If-None-Match` returned `304` for a public file, a WebP preview
  and a share thumbnail. Default-language anonymous `/`, `/new`, `/trending`
  and `/share/*` remained public; language/theme/query variants and the
  protected page returned `no-store`; robots/sitemap/manifest kept their
  documented public TTLs. The protected share still returned `403` before a
  token and `200` after it; the view-limited share returned `403` on the third
  view and still served its file at the limit.
- Playwright covered the guest, member and admin routes plus 390px dark-mode
  pages: every page returned the expected status, one H1, no horizontal
  overflow and no missing image alt attributes. The public share gallery
  opened/closed, a file downloaded as `photo.png`, a comment was created, and
  the protected flow showed one modal with an inline error before loading with
  the correct password. There were zero application console errors/warnings,
  page exceptions or failed requests after excluding the expected password/404
  status logs and third-party ad domains.
- All temporary shares, the temporary admin user and its cache/files were
  deleted after verification.

## Known non-issues

- Cloudflare does not echo `Cloudflare-CDN-Cache-Control`, but it honors
  `CDN-Cache-Control` (observed `HIT`).
- The ad container reserves about 90px plus 24px margins while third-party
  tags load, then collapses after 5s if no ad content is present. A
  `MutationObserver` reopens it if an ad arrives later. The media gallery is
  absent only when the share has no supported image/video files.
- Third-party ad scripts may log their own failed resource loads (for example
  an ad-network CSS/XHR request) in the browser console. These originate from
  the ad vendor, not application code; the app's own requests and pages stay
  error-free. Block the ad domains or use an ad-free network when validating
  the application console.
- Backend lint reports upstream warnings only.
- A fresh data directory logs one `ENOENT` from the temporary-file cron.
- The recent-visitor list is intentionally visible to every site visitor,
  matching the original fork behavior. It contains the last 18 visitors'
  country/city/browser/OS/referrer values.
- Cloudflare adds a duplicate `Cache-Control: no-store` beside the public value
  on cached responses for `/`, `/api/configs` and `/api/oauth/available`
  (including their `?v=<build>` keys). Fresh origin/cache-busted responses have
  a single public header, `CDN-Cache-Control` is unaffected and the edge still
  caches correctly. The app adds `?v=<build>` (see `version.util.ts`) so each
  deployment reads a fresh origin response. Purging those URLs or reviewing
  the edge Cache/Transform rule removes the duplicate; bodies are unaffected.
- Public comments are cached for 24 hours, keyed by the app's `?v=<version>`
  query. A request without `v` can keep an old copy until the edge TTL expires;
  the application always sends the version, and purging the comments URL clears
  stale unversioned entries.
- Chrome may log the expected `403` while a protected share page fetches its
  share token, and `404`s for intentionally missing shares. These are network
  status logs, not JavaScript exceptions; the page recovers and renders
  normally. Public shares no longer make the token request.
- Node 24+ prints an upstream `util._extend` deprecation warning at frontend
  startup.
- The home page's logged-in redirect uses a full `window.location.replace`
  instead of `router.replace`. When the access token expired while the browser
  was closed, the client refreshes it after hydration; a client-side router
  transition at that point could stall with the URL stuck on `/` and the main
  content blank. A full navigation lets the middleware see the refreshed cookie
  and load `/upload` immediately.
