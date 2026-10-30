# Fork maintenance notes

`droplinxuser/pingvin_source` is a lightly customized fork of
`smp46/pingvin-share-x`. Keep custom code out of upstream files where possible
so `git merge upstream/main` stays small. This file describes the **current**
state only; old verification runs are intentionally not kept.

See `docs/feature-roadmap.md` for the comparison with gofile.io / bunkr.cr and
the suggested order for future features.

## Custom areas

| Area | Main files |
|---|---|
| Environment loading / production config | `backend/src/constants.ts`, `backend/src/config/config.service.ts`, `backend/src/main.ts`, `backend/.env.example` |
| Rolling expiration (member 100 days / guest 10 days) | `backend/src/share/share.util.ts` (`SHARE_EXPIRATION`, `GUEST_SHARE_EXPIRATION`, `getShareExpiration`, `isMemberShare`), `share.service.ts` (create), `shareState.service.ts` (renew on visit), migrations `20261016000000` / `20261016000001`, share create/edit modals |
| Public-content search | `backend/src/cache/search.service.ts` (Valkey-backed index, no SQLite table/FTS), `GET /api/shares/search`, `frontend/src/components/header/NavbarSearch.tsx` (desktop form beside the logo, mobile icon on the right), `frontend/src/pages/search.tsx`. The stored index keeps only the card fields (no lowercase search text and no file names, since `/search` uses the centered file-only layout); the lowercase search text is derived in process memory on load, so the Valkey value does not duplicate every name and description. `/search` is `noindex`, so it does not SSR-fetch results: the client widget loads them (and a blank query never calls the API). The page memoizes its `loadItems` callback and keys the listing by query, so an empty result set cannot refetch in a render loop and a new query cannot keep the previous cards. An authoritative empty server listing is passed as `[]` and is never retried; only `null`/`undefined` (backend unavailable) falls back to the client loader. Results are edge-cached for five minutes and the route keeps its own bounded bucket because the query string makes the edge key unbounded. |
| Header navigation | Desktop navigation is a consistent text nav: Home/Upload, Trending, New (a dropdown with New media/New files), followed by the share menu and avatar controls. The mobile menu mirrors the same “New” submenu. The visible label is short (“Trending”), while the page title remains “Trending today”. |
| Member-only create options | In the create-share modal (`frontend/src/components/upload/modals/showCreateUploadModal.tsx`) the **Email recipients** and **Security options** accordions render only when `isUserSignedIn` is true; a guest upload gets just the link and name/description. |
| New-media / new-files / search listings | `backend/src/cache/trending.service.ts` (`getRecent` media-only, `getRecentFiles` no-media, both derived from one shared newest-shares SQLite scan), `GET /api/shares/recent-files`, `GET /api/shares/search`, `frontend/src/pages/new-media.tsx` and `search.tsx` (square preview cards via `TrendingToday.tsx`; on search, file-only cards use `fileOnlyLayout="centered"` — no file names, title + description centered), `new-files.tsx` (polished row/list layout via `frontend/src/components/share/ShareList.tsx`), `/new` 308-redirects to `/new-media` |
| Upload from URL (browser-fetched) | Direct URLs are downloaded by the visitor's browser (`frontend/src/utils/upload.util.ts` `fetchRemoteAsFile`), so the remote host never sees the server IP; the file is then uploaded through the normal chunked path. The stream is capped at `share.maxFileSize` (declared `Content-Length` first, then a running byte count) so a huge or endless response cannot exhaust tab memory. This requires the host to allow CORS. The fetch rejects an HTML/XHTML body (`RemoteNotAFileError`) so a landing page is never uploaded as a "file", and resolves the name from `Content-Disposition`, `X-Filename` headers or the URL path. `frontend/src/components/upload/UploadFromUrlButton.tsx` queues a real `File`, wired in `Dropzone.tsx` and the upload/edit flows |
| File-host import (Bunkr, MediaFire, Dropbox, Google Drive, OneDrive, pCloud, Pixeldrain, tmpfiles) | `backend/src/utils/fileHosts.util.ts` resolves a page URL to direct download URLs (`detectFileHost`/`resolveFileHost`); Bunkr reads `jsCDN` + `signUrl` from the page and signs the CDN link through an allowlisted `*.cdn.cr` host, MediaFire extracts the `download####.mediafire.com` link (base64 `data-scrambled-url` or plain), Dropbox appends `dl=1`, Google Drive/OneDrive build their public download API URLs, pCloud walks the public-link JSON, and Pixeldrain/tmpfiles rewrite to their `/api/file/` and `/dl/` links. These pages cannot be read cross-origin, so the server resolves and downloads them (`FileService.importFromUrl`), guarded by `backend/src/utils/remoteFetch.util.ts` (http/https only, ports 80/443, DNS validated and pinned, IP-literal check, redirect cap, size/time caps). `POST /api/shares/:id/files/from-url` now **only accepts allowlisted hosts** (`detectFileHost`/`detectMediaHost`), so the server never fetches an arbitrary URL. Gofile is intentionally rejected (`FileHostError` code `gofile`). Tests: `backend/test/file-hosts.test.js`, `backend/test/remote-fetch.test.js` |
| Media/video import (yt-dlp) | `backend/src/utils/mediaHosts.util.ts` allowlists well-known public platforms (YouTube, Vimeo, Dailymotion, Twitch, Streamable, Facebook, Instagram, TikTok, X/Twitter, Reddit, SoundCloud, Mixcloud, Imgur, Bilibili, NicoNico, TED, Bandcamp, Odysee, Rumble, BitChute, archive.org) and runs `yt-dlp` (single item, `--no-playlist`, `--ignore-config`, size cap, hard timeout, `--` before the URL, optional `YTDLP_COOKIES_FILE`). `FileService.importMediaFromUrl` downloads into a per-file temp dir, then feeds the bytes through the same chunk pipeline. Gated by `share.enableMediaImport` (admin config) and by the `yt-dlp` binary being present. Tests: `backend/test/media-hosts.test.js` |
| Cloudflare edge caching | Public search results and share images live at the edge for a short window: `GET /api/shares/search` and `/api/shares/:id/thumbnail` send `s-maxage=300` / `s-maxage=3600` respectively (`backend/src/utils/cache.util.ts` `getImageCacheHeaders`, `share.controller.ts`), the inline WebP preview in `file.controller.ts` uses the same image headers, and the search page shell is still `no-store` (query-dependent). Trending/recent listings keep a 60 s edge TTL. |
| Admin pagination, search and sorting | `backend/src/share/share.service.ts`, `backend/src/user/user.service.ts` (quota columns paged in SQL), `frontend/src/pages/admin/*`, `frontend/src/components/core/SortIcon.tsx` |
| Share reports | `backend/src/share/dto/reportShare.dto.ts`, `backend/src/email/email.service.ts`, `frontend/src/components/share/showReportShareModal.tsx` |
| Uploader metadata / visitors | `backend/src/utils/uploaderInfo.util.ts`, `ShareDTO.uploaderInfo`, `frontend/src/components/share/UploaderInfoBadges.tsx`, `ShareStats.tsx`; view counts stay in `Share.views`, written in five-second batches for unlimited shares and atomically for limited ones (`shareState.service.ts`). Geo labels are clamped before storage. The recent-visitor list is shown to every visitor. |
| Reverse-share use limits | `backend/src/reverseShare/reverseShare.service.ts` (`reserveUse`), `backend/src/share/share.service.ts` (reserve at create, reject invalid cookies, no refund on revert) |
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` (up to 100 image/video cards, 12-card lazy batches, single-media square card, full-size previous/next modal), `frontend/src/components/core/LazySection.tsx` |
| Individual downloads / legacy ZIP | `frontend/src/components/share/DownloadAllButton.tsx`, `frontend/src/services/share.service.ts`; `backend/src/share/share.service.ts` no longer creates archives. Existing `archive.zip` files remain served by the legacy API. The preview modal downloads through `shareService.downloadFile` too, so its clicks reach the download counters. |
| Share and file size limits | `backend/prisma/seed/config.seed.ts` (`share.maxSize` 5 GB, `share.maxFileSize` 512 MB), migration `20261025000000_raise_share_size_limit`, `backend/src/share/share.util.ts` (`resolveShareSizeLimit`), local/S3 upload guards, upload UI |
| Trending today / new shares | `backend/src/cache/trending.service.ts` (`getTrending`, `getTrendingCountries`, `getRecent`, `getRecentFiles`), `GET /api/shares/trending`, `/trending/countries`, `/recent`, `/recent-files`; `frontend/src/components/share/TrendingToday.tsx`, `TrendingCountries.tsx`, `ShareList.tsx` (polished row/list layout for `/new-files`), `frontend/src/pages/trending.tsx`, `new-media.tsx`, `new-files.tsx`, `search.tsx`. The main ranking counts only the last 24 hourly view buckets, ordered by 24-hour views then 24-hour downloads; shares still have to be public, completed and previewable, but there is no creation-age limit, so an older share with a recent view can appear. The country panel applies the same views-then-downloads order per country. The API result is cached 60 seconds in process and 60 seconds at the edge, and the frontend/SSR URL carries the build version as a cache-buster. Trending and the new listings cap at 200; rows/cards reveal in lazy batches with skeletons (infinite scroll). |
| Shared UI polish | `frontend/src/components/core/RelativeTime.tsx`, `RouteProgress.tsx`, `LazyImage.tsx`, `LazyVideo.tsx`, `LazySection.tsx`, `frontend/src/utils/filePreview.util.ts`; `frontend/src/components/share/FileList.tsx` adds client-side file search for shares with 12+ files (`SEARCH_MIN_FILES`), filtering the rendered batches and the preview navigation without a backend request |
| Profile pictures | `backend/prisma/schema.prisma` (`User.avatarUpdatedAt`), migration `20261028010000_add_user_avatar`, `backend/src/user/avatar.service.ts` (5 MB/40 MP limits, EXIF rotate, 256px centre-crop, metadata-stripped WebP, atomic 0600 write), `user.controller.ts` (`POST`/`DELETE /api/users/me/avatar`, public versioned `GET /api/users/:id/avatar.webp` with ETag/304), `frontend/src/components/core/UserAvatar.tsx`, `frontend/src/utils/avatar.util.ts` |
| Legal pages | `frontend/src/content/legalDocuments.ts` (built-in imprint/privacy markdown that ships with the app), `frontend/src/components/legal/LegalDocument.tsx` (one shared layout). `/imprint` and `/privacy` server-render the text with the current site name/URL, upload limits, ZIP limit and guest-upload setting, then remain edge-cacheable. The public text is user-facing only: it does not name hosting, storage, delivery, security, malware-analysis or other backend providers, and it carries a visible last-updated date. Legacy admin legal text is ignored; `_app` still strips it from the shared payload for old installs. |
| Contact page and Cloudflare Turnstile | `frontend/src/pages/contact.tsx`, `frontend/src/components/contact/TurnstileWidget.tsx`, `backend/src/contact/*`, `EmailService.sendContactEmail`. `CFT_KEY`/`CFT_SECRET` verify the widget server-side; the validated message is emailed to `REPORT_EMAIL` (falling back to `smtp.email`) in the background. The public config endpoint exposes only the site key. |
| Upload paste and folder picks | Upstream `useClipboardPaste.hook.ts`, `file.util.ts`, `folder.util.ts`; the fork keeps only `share.maxFileSize` validation in `Dropzone.tsx`, the folder button and upload DTO bounds |
| Share thumbnails / OG | `backend/src/file/file.service.ts` (share-level 300px WebP, ordered preview fallbacks, background queue, 32-day cleanup), `backend/src/share/preview.util.ts`, `GET /api/shares/:id/thumbnail`, listing cards and `Meta.tsx` |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts`, `frontend/src/utils/version.util.ts`, `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts`, `frontend/next.config.js` |
| Per-IP+User-Agent rate limiting | `backend/src/utils/visitorIdentity.util.ts`, `backend/src/cache/valkeyThrottler.storage.ts`, `backend/src/cache/throttler.config.ts`, `backend/src/main.ts` |
| Valkey cache | `backend/src/utils/cache.util.ts`, `backend/src/share/shareState.service.ts`, `backend/src/cache/*` |
| Hot-path queries and cache fills | `shareState.service.ts` (view counters, comment-only invalidation), `share.service.ts` (SEO fill), `metrics.service.ts`, `system.service.ts`, `trending.service.ts` (recent fill), migration `20261028000000_add_relation_indexes` |
| VirusTotal background scanning | `backend/src/virustotal/*`, `backend/src/share/share.service.ts` (completion hook), `backend/src/clamscan/clamscan.service.ts` (shared malicious-share removal), `frontend/src/pages/admin/virustotal.tsx`, `backend/.env.example` |
| VirusTotal per-file result + badge | `backend/src/virustotal/virustotalReport.util.ts` stores a compact verdict per scanned file in the share's own directory (`<share>/virustotal.json`, atomic write, bounded, no SQLite column); `VirusTotalService.recordReport` writes clean/suspicious verdicts (malicious files are removed instead); `shareState.service.ts` merges the entry into each file so `/api/shares/:id` exposes `files[].virustotal`; `frontend/src/components/share/VirusTotalBadge.tsx` renders a shield icon (teal = clean, orange = suspicious) with a tooltip (“N malicious · N suspicious · N undetected”, hash, scanned time), shown in `FileList.tsx` |
| Site stats, referrers and footer | `backend/src/system/system.service.ts`, `backend/src/cache/metrics.service.ts`, `frontend/src/components/footer/Footer.tsx`, `frontend/src/pages/admin/referrer.tsx`, `POST /api/system/pageview` |
| Valkey metrics and error logs | `backend/src/cache/valkeyMetrics.util.ts`, `backend/src/logs/*`, `GET /api/system/valkey`, `frontend/src/components/admin/ValkeyMetricsCard.tsx`, `frontend/src/pages/admin/logs.tsx`, `frontend/src/utils/errorReporter.util.ts` |
| Server dependency panel | `backend/src/utils/dependencies.util.ts` (bounded binary/TCP probes plus the shared `getFfmpegCandidates`), `SystemService.getDependencies` and `GET /api/system/dependencies` (admin-only), `frontend/src/components/admin/ServerDependenciesCard.tsx` (rendered below the Valkey card on `/admin`). Reports Node.js, sharp, ffmpeg, the SQLite connection, Valkey, yt-dlp and ClamAV with version, required/optional and an availability badge, so a moved server is easy to audit. |
| SQLite metrics panel | `backend/src/utils/sqlite.util.ts` (`DatabaseMetrics` + fragmentation), `SystemService.getDatabaseMetrics` and `GET /api/system/database` (admin-only), `frontend/src/components/admin/DatabaseMetricsCard.tsx` (below the dependency card on `/admin`). Reads `PRAGMA database_list/page_size/page_count/freelist_count/journal_mode` and the on-disk `.db`/`-wal`/`-shm` sizes (admin-only) to show size, pages, free pages, journal mode and the SQLite version; a fragmentation hint recommends the `maintain-db.js` VACUUM. |
| Home copy and ads | `frontend/src/pages/index.tsx`, `home.custom.*` keys in `en-US.ts`, `frontend/src/components/Ads.tsx` (guest-only; shown on every guest share/404 request including protected, view-limited and private shares; skipped for signed-in visitors and while a reverse-share upload cookie is active). Upstream `useHomeHref` owns every "go home" target. |
| Fork branding / deployment | `frontend/public/img/**`, `frontend/public/favicon.ico`, `frontend/src/pages/manifest.json.tsx`, `pingvin-*.service`, `update.sh` |
| SEO / crawlers | `frontend/src/components/Meta.tsx`, `SiteStructuredData.tsx`, `frontend/src/hooks/siteMeta.hook.ts`, `frontend/src/pages/robots.txt.tsx`, `sitemap.xml.tsx`, `frontend/src/utils/seo.util.ts`, `seo.server.util.ts`, `backend/src/share/share.service.ts` (`getSeo`), `backend/src/system/system.service.ts` (disk-backed robots/sitemap), `frontend/src/pages/_app.tsx` (default-locale message trimming) |
| WebP / image pipeline | `backend/src/file/file.service.ts` (per-file and share-level previews), `backend/src/file/file.controller.ts` (`webp=300`), `backend/src/config/logo.service.ts`, `frontend/src/utils/file.util.ts`, `frontend/src/components/Logo.tsx`, `frontend/public/img/*.webp` |

Fork-only UI strings live in `frontend/src/i18n/translations/en-US.ts`; other
locales fall back to English through `frontend/src/utils/i18n.util.ts`. New fork
strings must use new `*.custom.*` keys so other languages show the English
fallback rather than the upstream copy.

Shared fork-only backend helpers live in `backend/src/utils/`:
`keyedLock.util.ts` serializes per-share read-modify-write tasks,
`fileWrite.util.ts` writes JSON/state files through a unique temporary file plus
atomic rename, and `remoteFetch.util.ts` is the only allowed outbound downloader
(SSRF-guarded; `backend/test/remote-fetch.test.js` covers the address blocks).
Reuse them instead of adding another lock, temp-file block or raw `fetch(url)`.
`share.util.ts` exports `shareWriteLock`, the single per-share lock used by local
and S3 chunk writes plus `complete`/`revertComplete`; keep every path that
publishes a `File` row inside it so completion cannot snapshot a half-finished
upload. Share thumbnails and per-file WebP previews use separate bounded queues
(a thumbnail may call the preview builder; one shared queue would deadlock).
Public-share predicates live in `share.util.ts` (`publicShareWhere`,
`activeShareWhere`, `isPublicShare`) and must be reused by new queries.
Cross-cutting pagination, country, referrer, storage-quota and MIME logic live in
the matching `utils/*.util.ts` files.

## SEO, performance and accessibility pass

- `_app.getInitialProps` omits `pageProps.messages` for the default English
  locale. The English catalogue is already part of the client bundle, so
  serializing it into `__NEXT_DATA__` only added ~70 KB to every English page.
  Other locales still receive their merged messages for a matching first render.
- The legal markdown is now part of the application (`content/legalDocuments.ts`)
  instead of an admin-owned text field, so a release that adds a feature can
  update the notice in the same commit. The shared `LegalDocument` layout owns
  the single page `h1`; the built-in documents start at `h2`, so `/imprint` and
  `/privacy` do not render a second `h1`. `/imprint` and `/privacy` still read
  the live config on the server for the site name/URL and use the normal
  60-second public HTML cache. `_app` continues to replace any legacy admin
  legal text with a presence marker so old installs do not serialize large
  documents.
- `/trending` renders only the selected country tab (`keepMounted={false}`);
  before this, ten panels with 100 hidden thumbnails and about a thousand extra
  DOM nodes were mounted on every visit.
- The share page's server skeleton uses `seo.thumbnailUrl` as an eager,
  `fetchpriority=high` LCP image and the first video poster. The hero uses a
  stable grid with a reserved uploader row, and the gallery caption skeleton
  matches the real caption height, so the payload arriving after SSR does not
  shift the page (CLS was ~0.22, now ~0.01-0.04 locally).
- The first four listing cards load eagerly and hint high priority; the rest
  keep `loading="lazy"`. Brand assets generated by
  `frontend/scripts/generate-brand-assets.mjs` are square 400x400, matching the
  fixed logo dimensions used by the header and home page.
- Accessibility: `gray[6]` is darkened to `#5f6773` so Mantine `dimmed` text
  passes WCAG AA; status badges use the `dot` variant (colored dot, neutral
  text) or `red.9`/`orange.9`; every icon-only action, pagination control, sort
  button and mobile menu control has a name; progress indicators are hidden
  from the accessibility tree; uploader icons use `role="img"`; ad iframes and
  injected full-page links are labelled; content links in the admin intro are
  underlined. Page headings use h1 -> h2 (admin config sections included).
  The multi-file "Download all" button uses `cyan.9` on the light variant
  (5.15:1); plain `cyan` was 2.56:1. The disabled placeholder in
  `ShareActions.tsx` uses the same shade.
- Interactive elements are not nested: icon links use
  `ActionIcon component={Link}` (or `component="a"`) instead of an icon inside
  an `<a>`, so one control is one tab stop. The share breadcrumb is wrapped in
  a `nav[aria-label="Breadcrumb"]`, and view-count badges carry `role="img"`
  so their count label is not ignored on a generic span. Public listing
  JSON-LD is built once by `buildShareListCollectionPage`; listing cache
  headers are set by `setListingCacheHeaders`.
- The footer uses slightly larger muted text and vertical padding on links for
  comfortable touch targets.
- Large shares (>12 files) get a compact search field above the file table.
  Filtering is client-side and uses `useDeferredValue`, so typing stays
  responsive while a few thousand rows are compared. The table header, empty
  state, result count (`aria-live`) and skeleton variant reserve the same space
  to avoid layout shift. The file list skeleton mirrors the search bar when the
  known file count is large.
- `_app` memoizes the assembled Mantine theme. The admin primary colour scale
  is built from ten blended hex values, and rebuilding it on every notification,
  modal or session restore was unnecessary; only a theme config or colour
  scheme change recreates it.
- Local Lighthouse (mobile, production build): home ~96 performance and 100
  accessibility/SEO/best-practices; trending/new ~87-96 performance; share
  pages remain limited by third-party ad scripts (best-practices 61 from their
  cookies/deprecations), while the app shell itself is error-free. Axe reports
  zero violations on guest, member and admin pages at 390 px.

## Upstream sync

- Last merge: `61101a1e` (`fix(oidc): spec-compliant token validation`) from
  `upstream/main`. The branch is no longer behind upstream.
- The only conflict was `backend/src/oauth/provider/genericOidc.provider.ts`.
  The resolution keeps upstream's `jose` verification and deletes the fork's
  now-redundant manual `sub`/`exp` checks, while retaining the fork's log
  redaction and the discovery-URL normalisation in `oidc.provider.ts`.

## Merge checklist

1. `git fetch upstream && git merge upstream/main` on a branch.
2. Resolve conflicts mainly in `share.service.ts`, the share create/edit modals,
   `createShare.dto.ts` / `createReverseShare.dto.ts`, and the upload files
   (`Dropzone.tsx`, `pages/upload/index.tsx`, `utils/file.util.ts`). Keep the
   upstream clipboard/folder helpers and re-apply only the fork per-file cap,
   folder button and dropzone copy.
3. Re-check the production settings below after any config seed change.
4. Run:
   - backend: `npm ci && npm run build && npm run test:unit`
     (`npm run test:unit:fast` skips the rebuild for quick iterations)
   - frontend: `npm ci && npm run build`
   - lint: `npm run lint` in both packages (backend warnings are upstream-only)
5. Smoke-test locally: home, sign-in, upload, share page, comments, gallery,
   admin shares/users/referrers/VirusTotal/Valkey/logs pages, missing share
   (404), trending widget, `/trending`, `/new-media`, `/new-files`, `/search`,
   file download headers, report
   modal, footer metrics, profile pictures, manifest, robots and the versioned
   sitemap index/chunk. Repeat with Valkey stopped to confirm fallbacks (the
   trending widget and referrer/Valkey cards degrade gracefully).

## Production settings

- `security.allowRegistration=false`; `oauth.allowRegistration=true`;
  `oauth.disablePassword=false`.
- `share.maxSize` is 5 GB per share and `share.maxFileSize` is 512 MB per file.
  The per-file cap keeps each download within Cloudflare's cacheable-file limit;
  multi-file shares download file by file instead of as an archive.
- Expiration is rolling and automatic; `share.maxExpiration` /
  `share.defaultExpiration` are intentionally absent from the seed and DTOs.
- Report notifications and contact-form mail use `REPORT_EMAIL` from
  `backend/.env`, falling back to the configured SMTP sender. Set `CFT_KEY` and
  `CFT_SECRET` from Cloudflare Turnstile to enable the public contact form; the
  key is exposed through `GET /api/contact/config`, the secret never leaves the
  server. The message is queued in the background after verification.
- Video/media URL import (`share.enableMediaImport=true`) needs the `yt-dlp`
  binary on `PATH`. `update.sh` does not install it; install it with the
  distribution package (`sudo apt install yt-dlp`) or `pipx`. Platforms that
  require a signed-in cookie from a datacenter IP (notably YouTube) can use an
  optional `YTDLP_COOKIES_FILE` Netscape cookie jar. Without the binary, media
  links return a clear "not available" error.
- `backend/.env` is authoritative for the backend and systemd unit. Keep the
  live database URL exactly:
  `DATABASE_URL="file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1"`
- `DATA_DIRECTORY="/var/www/pingvin_data"`. Uploader/visitor metadata is a
  per-share `uploads/shares/<shareId>/uploader.json` (mode `600`). Sitemaps are
  written to `DATA_DIRECTORY/sitemaps/<site-hash>/` and are derived data.
- There is one base rate-limit policy: 90 requests per 60 seconds per client,
  identified by client IP + browser `User-Agent`, blocking for 60 seconds. The
  upstream per-IP `THROTTLE_LIMIT` bucket is gone; routes without an explicit
  `@Throttle` override share the visitor bucket, keyed by the hashed IP+UA.
  A route with an explicit limit (auth, upload, comments/reports/contact, SEO,
  etc.) gets its own visitor bucket keyed by route + hashed IP+UA. This keeps a
  strict comment limit from being consumed by ordinary page/API traffic and
  keeps a high upload/SSR limit from raising the global bucket. Configure with
  `VISITOR_RATE_LIMIT`, `VISITOR_RATE_TTL_MS`, `VISITOR_RATE_BLOCK_MS`.
  The backend uses Valkey when available and falls back to memory. The Next
  middleware applies the same policy to non-cacheable page HTML
  (`utils/pageRateLimit.util.ts`); cacheable anonymous shells are skipped.
  Config/OAuth, stats/trending/recent, SEO and file/ZIP reads skip the shared
  bucket because they are edge-cacheable or have no unbounded query key.
  Search, comments reads, thumbnails and the share `HEAD` check carry their own
  route buckets instead: their query strings (`q`, `page`, `v`) or IDs are
  attacker-controlled, so a unique value can always miss the edge without
  throttling the origin.
- Valkey/Redis is optional but recommended: set `CACHE_REDIS_ENABLED=true` and
  `CACHE_REDIS_URL=redis://127.0.0.1:6379`. `update.sh` enables both when a local
  `valkey-server` is active. When Valkey is down, cache reads fail open to
  SQLite, metrics/logs use bounded memory fallbacks, and a dead client cannot
  hang a request (`disableOfflineQueue` + error handlers).
- `update.sh` pulls origin/main, preserves `backend/.env` and local branding,
  rebuilds both packages, installs the systemd units, runs migrations/seeding
  through the backend restart, then restarts the frontend. It must run as root:
  `sudo bash /var/www/pingvin_source/update.sh`.
- Keep an up-to-date database copy at `/home/rt/Documents/pingvin-share.db`
  (`PRAGMA integrity_check` must return `ok`).
- The production proxy must send `/api/*` directly to the backend
  (`127.0.0.1:8080`), not the Next dev proxy on `3030`, with
  `proxy_buffering off`, `proxy_request_buffering off` and long timeouts.

## Storage and query model

- **Valkey first.** Trending, country rankings, recent listing cache, page-view
  metrics, top referrers, error logs, VirusTotal jobs/verdicts/request spacing,
  throttling buckets and short-lived share data all live in Valkey. SQLite is
  the durable source for shares, files, users and counters only.
- Config reads use an in-process key index (`ConfigService.findConfigVariable`,
  `frontend/src/utils/config.util.ts`) that is rebuilt only when the config
  array is replaced. This keeps the many `config.get()` calls per request off
  the linear scan without caching typed values, so admin edits are immediate.
- Public search scores each matching entry once before sorting instead of
  lowercasing the name and description again inside every comparator.
- Trending reuses the 24 hourly geo hashes for views. Each renderable share
  writes `<country>:<shareId>` (or `XX:<shareId>` when the request has no valid
  country), and the main ranking sums the last 24 hashes. The country panel
  ignores the `XX` fields, so both views stay on the same small key set.
  Downloads use one hourly sorted set (`pingvin:downloads:hour:<hour>`, TTL
  25 h); the main read unions the last 24 with `SUM` for the tie-break. No
  SQLite seed is possible for a 24-hour window, so the ranking starts from views
  recorded after the change; old daily view keys expire on their own.
- The unactivated-user cleanup also removes uploads made through the user's
  reverse shares (they have no `creatorId`), matching the admin user-delete
  path so no file bytes are orphaned on disk/S3.
- Share page data and guard data are cached for 30 seconds; SEO for 60 seconds.
  A cold-cache burst shares one in-flight load. Cache fills are generation
  checked, so a read that started before an edit cannot restore a stale share.
  Comment mutations invalidate only the share payload; the security and SEO
  entries stay valid.
- Unlimited share views are batched into one SQLite write every five seconds
  (`VIEW_WRITE_DELAY_MS`); limited shares use one conditional
  `UPDATE ... RETURNING` so the limit check and increment cannot race. Pending
  counts are flushed on shutdown.
- The `/new-media` and `/new-files` listings are derived from one shared
  newest-shares scan (30-second in-process cache), so opening both pages in the
  same window costs one indexed SQLite read instead of two. The public search
  index stores only display fields in Valkey and rebuilds the lowercase search
  text in memory on load, avoiding a second copy of every name and description.
- A data-cache miss resets the rolling expiration in the response; the
  corresponding SQLite write is throttled to once per six hours per share and
  process.
- Visitor metadata is coalesced into one `uploader.json` write per second per
  share, with a bounded in-process snapshot so later views do not re-read the
  file. Edits/deletes drop the snapshot; shutdown flushes pending entries.
- Admin share/user sorting and pagination run in SQL. Admin user rows select
  DTO fields only (no password hashes or TOTP secrets). The upload quota is one
  aggregate query.
- The sitemap is built from one SQLite read per ten-minute refresh and written
  to disk as an index plus 50,000-entry chunks. Nothing is stored in SQLite,
  Valkey or process memory. Content-hash `?v=` query strings version every chunk
  and the robots pointer. The home-page entry is written only when
  `general.showHomePage` is enabled, since the page 302s to `/upload` otherwise.
- A reverse-share upload links its share in the same `Share` INSERT (a nested
  connect on the unique reverse-share token), so it no longer pays a second
  `UPDATE`. The chunked and URL import paths both re-check `uploadLocked`; the
  URL importer checks it once before downloading instead of once per resolved
  host file, and `getZip` reuses `sumFileSizes` for its size cap.
- The database keeps only one row per user avatar version (`avatarUpdatedAt`);
  the image itself is a file in the data directory.
- No custom feature adds a SQLite table except the avatar version column and
  the relation/performance indexes in the recent migrations.
- SQLite maintenance: `Share_creatorId_idx` and `Share_reverseShareId_idx` are
  partial indexes (`WHERE ... IS NOT NULL`) because anonymous shares leave
  `creatorId` NULL and normal shares leave `reverseShareId` NULL. This keeps
  lookups indexed without storing thousands of empty keys. Migration
  `20261029000000_optimize_share_indexes` applies the change.
  `backend/scripts/maintain-db.js` runs `VACUUM` while the backend is stopped;
  `update.sh` calls it after `prisma migrate deploy`. It logs and skips on
  failure, so a full disk cannot break an update.
- A database audit found no orphaned rows (`File`, `ShareSecurity`,
  `ShareRecipient`, `ShareUserRecipient`, `RefreshToken`, `OAuthUser`) and no
  obsolete tables or columns. The remaining size is almost entirely legitimate
  share/file metadata (`File` and its primary-key index), so the fork does not
  delete share content during maintenance. Reclaimable index/fragmentation space
  is handled by the migration + `VACUUM`; on the 16k-share reference database
  this reduced the file from 9.49 MB to 8.54 MB with integrity `ok`.
- `share.util.ts` owns the expiry rule (`isShareExpired`): the epoch means
  "never expires". Every guard, listing and cache path uses it instead of a raw
  date comparison, so an epoch share cannot be treated as expired in one route
  and valid in another.
- View-limited shares fill the short `limitedViewCounts` cache after reading
  the counter, so a gallery with N files costs one SELECT instead of one per
  file request. Completion links registered recipients with one `findMany` plus
  one `createMany` instead of a serial UPSERT per address, and a failed share
  create removes its directory and refunds the reserved reverse-share use.
- The rolling-expiration write is best-effort and no longer awaited on the
  share read path; a transient SQLite error is logged and retried on the next
  cache miss instead of failing the page. `revertComplete` invalidates the
  public search index, so an un-completed share cannot stay searchable.
- In-flight upload bytes are tracked per share and per quota owner. They are
  returned when the file completes, when the share is deleted, or when the
  daily cleanup removes an abandoned `.tmp-chunk`/`.remote` file, so a dropped
  upload cannot hold another account's quota until a restart. Share deletion
  only removes a share directory when no `Share` row owns that id, so a losing
  concurrent create cannot delete the winner's files.
- Only the first uploaded chunk removes the legacy `archive.zip`; later chunks
  skip the guaranteed-ENOENT unlink. The SEO loader computes the share size
  from the already-loaded first 50 files and only runs the `SUM` query for
  larger shares. The recipient download notification starts its cooldown only
  after a successful SMTP send.

## HTTP caching

Origin responses set `Cache-Control`, `CDN-Cache-Control` and
`Cloudflare-CDN-Cache-Control` consistently (`utils/cache.util.ts`).

- Public HTML shells (`/`, `/trending`, `/new-media`, `/new-files`, `/contact`,
  `/share/*`, legal pages) are
  `public, s-maxage=60, stale-while-revalidate=30, stale-if-error=300` only when
  the URL has no query string, the language is the default and the theme is
  unset or light. Authenticated, non-default-language, `?lang=`, `?recipient=`
  and other query variants stay `no-store`. Pages never put account data in
  `__NEXT_DATA__`; `_app` restores the user client-side.
- Config and OAuth availability: 30 seconds. Stats, trending, recent,
  recent-files and share SEO: 60 seconds; public search results: 300 seconds
  (the index TTL), so a deleted/protected share cannot remain discoverable
  through a stale edge result for an hour. An empty search
  result is `no-store` so a transient miss is never pinned at the edge. Trending
  countries: 300 seconds. Comments: 24 hours with an
  app version query; an unversioned comment URL is `no-store`. Sitemap index:
  1 hour. Sitemap chunks, robots and manifest:
  1 day (60-second fallback when the backend artifact is unavailable).
  `/_next/static` and Workbox bundles are immutable for a year.
- Public file and preview GETs use a one-hour browser TTL and a **ten-minute**
  shared TTL (no `immutable`) so deletions propagate quickly, plus an `ETag`
  and `304` support. Protected files are `private`. ZIP responses are 60 seconds
  for public shares and `no-store` for protected ones.
- Share thumbnails and avatars are public for one day, versioned through the
  URL (`?v=<updatedAt>` / `<avatarUpdatedAt>`) and `no-store`/`private` when the
  content is protected. The proxy may lengthen browser TTLs for image-looking
  URLs; `CDN-Cache-Control` remains the edge authority.
- Auth, account, admin, upload, edit, error and missing-share pages are
  `no-store`. `_next/data` client-navigation responses are explicitly
  `no-store`: Next runs the middleware for those requests with the *page* path,
  so the middleware detects the router's data request (`x-nextjs-data` /
  `x-middleware-prefetch`) and forces `no-store`. Otherwise the CDN could cache
  a build-ID data payload and blank the page after a deploy until a hard
  reload. Also keep a Cloudflare Cache Rule that bypasses `/_next/data/*`.
- Cloudflare does not cache HTML/JSON by default. Scope a Cache Rule to the
  public HTML routes, config/stats, trending/recent/countries/SEO/thumbnail,
  sitemap/robots and public files; bypass requests carrying an `access_token`
  cookie. Bypass cache for `/sw.js` and purge old HTML/service-worker responses
  after deployments.

## Security and SEO notes

- Public share/file reads skip JWT authentication; protected shares still run
  the full token/password/recipient/max-view checks. Comment mutations,
  uploads, account and admin routes authenticate normally.
- Passwords are length-bounded on every auth/share path; unknown usernames pay
  the same Argon2 cost; LDAP refuses empty passwords. Cookies are `Secure` when
  `general.appUrl` is HTTPS, share-token cookies are `SameSite=Lax`, and the
  refresh cookie is `HttpOnly`.
- OAuth callbacks require state, and OIDC ID tokens are verified with `jose`
  against the discovery issuer (tenant-aware for Microsoft), the configured
  JWKS and client ID, including `azp`, `sub`, `exp`/`iat` and the nonce.
  Provider IDs cannot be empty. The fork keeps the discovery-URL normalisation
  in `oidc.provider.ts`, and redacts token fields/claims from every OIDC log
  line, so tokens are never logged.
- Reverse-share tokens cannot bypass `allowShare`/`maxShares`; a use is reserved
  atomically at share creation. `CreateShareGuard` is only on `POST /shares`;
  upload/complete/revert/file routes use `StrictShareOwnerGuard` so an
  in-progress upload is not rejected by the remaining-use check.
- Upload bodies use class-validator DTOs (safe names, bounded chunks/parts) and
  the service caps chunk count against `maxFileSize`/`chunkSize`. Active
  documents (HTML/SVG/XML/JS/CSS) are forced to attachment/octet-stream on
  inline reads.
- Remote URL upload is owner-only and rate-limited (`POST
  /api/shares/:id/files/from-url`). It downloads server-side with `remoteFetch
  .util.ts`: http/https on ports 80/443 only, DNS results validated and pinned
  to a public address (and IP-literal hostnames rejected before connecting, so
  Node's lookup-skip cannot bypass the check), a short redirect chain that is
  re-validated per hop, and body/time caps. IPv6 literals are accepted only in
  the global-unicast `2000::/3` block (with documentation, Teredo and 6to4
  excluded), which also blocks IPv4-mapped/compatible spellings such as
  `::ffff:7f00:1`. Bytes then flow through the same chunk pipeline, so quota,
  share/file limits and the VirusTotal/ClamAV hooks all still apply. Media
  hosts are extracted by `yt-dlp` only when the host is on the allowlist and
  `share.enableMediaImport` is on; a hard timeout, a size cap and the absence
  of user config bound the process, and the downloaded bytes still pass
  through the same chunk pipeline.
- The public download beacon (`POST /api/shares/:id/download`) accepts at most
  500 well-formed ids and keeps only file ids that belong to that share, so it
  cannot create Valkey fields for arbitrary ids; the reserved `total` field is
  rejected as a file id. Guest ads are never mounted on a non-indexable
  (password/recipient/view-limited) share.
- Local uploads reserve in-flight bytes per share and per user. Completion
  re-checks the aggregate share size and the user quota. Completed shares reject
  further uploads. Expired shares cannot be revived through the owner path.
- Frontend and Express omit `X-Powered-By`; Next sets
  `X-Content-Type-Options: nosniff`. The Angie h5bp include owns
  `X-Frame-Options` and `Referrer-Policy`, so the app does not duplicate them.
  The app adds `Permissions-Policy`, `Cross-Origin-Opener-Policy` and
  `X-Permitted-Cross-Domain-Policies`.
- SEO: one title/description/canonical/robots per page, Open Graph + Twitter
  cards, a 1200x630 default OG image (or the share thumbnail), JSON-LD
  Organization/WebSite plus page-specific `SoftwareApplication`,
  `CollectionPage`, `ItemList`, `BreadcrumbList` and `DigitalDocument`.
  Query strings and trailing slashes are stripped from canonicals; `/s/:id`
  permanently redirects to `/share/:id`. A configured localhost `general.appUrl`
  is treated as unset in production builds, so pages emit relative
  canonical/OG URLs instead of `http://localhost:3000`. Protected shares return
  only `{ indexable: false, id }` from the SEO endpoint and never derive labels.
  The SEO endpoint uses a larger 1,200/min visitor bucket (instead of 90/min)
  because Next SSR reads it from one host IP; the edge-cached payload still
  returns immediately for repeat share links, and random-id scans stay bounded.
- Share metadata is auto-generated when the owner leaves title/description
  empty; owner-written text wins and is followed by a short count/size summary.
  The same label is used for H1, breadcrumb and JSON-LD; protected shares never
  expose one.
- `GET /api/shares/:id/seo` replaces the SSR `HEAD` probe, carries a 60-second
  edge TTL and a short in-process cache, and returns a real 404 for
  missing/expired/removed shares.
- Large listing pages reserve space with skeletons and reveal cards in batches
  (24 for trending/recent, 12 for the gallery, 50 for file rows). The preview
  modal is a lazy chunk. The footer stats request starts in
  `requestIdleCallback` and reserves eight country slots.
- OS/browser glyphs use compact brand colours with a neutral fallback.
  `RelativeTime` shows localized relative timestamps with a full-date tooltip;
  one module-level ticker updates every instance.

## Known non-issues

- Cloudflare does not echo `Cloudflare-CDN-Cache-Control`; it honours
  `CDN-Cache-Control` (observed `HIT`).
- Cloudflare may add a duplicate `Cache-Control: no-store` beside the public
  value on cached `/`, `/api/configs` and `/api/oauth/available` responses. The
  origin emits one header, `CDN-Cache-Control` is correct and the edge caches
  properly; purging or reviewing the edge rule removes the duplicate. The app
  versions config/OAuth URLs with the build hash so each deploy reads a fresh
  origin response.
- Comment URLs are versioned (`?v=<commentsVersion>`); an unversioned request
  is explicitly `no-store`, so it can never pin a stale comment page. The app
  always sends the version.
- Thumbnail/avatar URLs are versioned. A browser or edge copy of a removed
  avatar can survive until its TTL, while new pages show the initials fallback.
- After a share is deleted, Cloudflare may serve its last public shell for the
  remaining 60-second `s-maxage` window; the API and client payload already
  return 404.
- Third-party ad scripts may log their own failed resource loads. The app's own
  pages and requests stay error-free; block the ad domains when auditing the
  console. The ad container collapses after five seconds when no creative
  arrives and reopens through a `MutationObserver` if one does.
- Chrome logs the expected network `404` for intentionally missing shares. It
  is a status log, not a JavaScript exception.
- `npm audit --omit=dev` is clean for the backend. The frontend reports five
  low-severity build-time advisories through
  `next-pwa -> workbox-build -> @rollup/plugin-node-resolve -> deepmerge`; the
  suggested fix downgrades `next-pwa`, so it is intentionally not applied.
  Workbox runs only during builds.
- Backend lint reports upstream `any` warnings only.
- Node 24+ prints an upstream `util._extend` deprecation warning at frontend
  startup.
- The home page's logged-in redirect uses a full `window.location.replace` so
  an expired access token is refreshed through middleware before `/upload`
  loads.

## Verification baseline

The current suite covers: view limits and batched counters, visitor identity,
Valkey/fallback throttling, uploader metadata, HTTP cache matching, storage
quota, missing local files, page-view metrics, admin metrics, error logs,
trending/recent/country ranking and cache behavior (including the 24-hour geo
view aggregation and download tie-break), public search index
storage/matching/versioning,
share thumbnails, sitemap
index/chunks/robots, comments, archive-encryption detection, VirusTotal
audit/queue/filter/removal/notification flows, reverse-share guard wiring,
referrers, avatars and the contact form (Turnstile success/failure, background
email queuing and header sanitization). `share-util.test.js` pins the
epoch/expiry rule and the overflowed-size fallback; `remote-fetch.test.js`
covers IPv4-mapped/compatible IPv6 spellings; `throttler-config.test.js` pins
the shared-vs-route bucket split; `jobs.test.js` covers reverse-share upload
cleanup; `config-service.test.js` pins the config lookup reload; and the search
suite covers ranking order. A local mock-OIDC check signs RS256 ID tokens and
verifies that a valid token is accepted while expired, wrong-issuer, wrong-nonce
and tampered-signature tokens are rejected through the merged `jose` path.
Keep this suite green before pushing; run the frontend production
build and lint in the same pass. Playwright smoke checks should cover
guest, member and mobile views of the public pages, upload/download/comment,
URL upload, admin redirects and the share gallery with zero application console
errors or warnings (the intentional 404 document status is excluded). Also
verify that `/search` sends no API request for an empty query, that a zero-result
query clears the previous cards, that a preview-modal download sends the
`POST /api/shares/:id/download` beacon, that `/d/` counts one page view, that a
protected share mounts no ad scripts, that a browser URL upload streams a
small file correctly, that the contact button stays disabled until Turnstile
returns a token, that guest ads appear on protected/private share and 404 pages,
and that the header order is Home/Upload, Trending, New (New media/New files).
Also check that a versioned comments URL is `s-maxage=86400`, an unversioned
one is `no-store`, `HEAD /api/shares/:id` is `s-maxage=60`, search results are
`s-maxage=300`, and the search/comments/thumbnail/HEAD route buckets throttle
independently from the shared visitor bucket.
Rate-limit smoke tests: 95 requests from one IP+UA to a
non-cacheable API and page return 90 successes then 429, while a different UA
and a cacheable page remain available. Axe checks at 390 px
should report zero WCAG A/AA and best-practice violations for the public pages,
member account pages and every admin page; the temporary local admin promotion
used for that check must be reverted afterwards.

Live deployments are verified by the site administrator after
`/var/www/pingvin_source/update.sh`; do not run that script from an agent
session.
