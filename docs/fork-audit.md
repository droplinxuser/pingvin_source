# Fork maintenance notes

`droplinxuser/pingvin_source` is a lightly customized fork of
`smp46/pingvin-share-x`. Keep custom code out of upstream files where possible
so `git merge upstream/main` stays small. This file describes the **current**
state only; old verification runs are intentionally not kept.

## Custom areas

| Area | Main files |
|---|---|
| Environment loading / production config | `backend/src/constants.ts`, `backend/src/config/config.service.ts`, `backend/src/main.ts`, `backend/.env.example` |
| Rolling 100-day expiration | `backend/src/share/share.util.ts` (`SHARE_EXPIRATION`), migrations `20261016000000` / `20261016000001`, share create/edit modals |
| Admin pagination, search and sorting | `backend/src/share/share.service.ts`, `backend/src/user/user.service.ts` (quota columns paged in SQL), `frontend/src/pages/admin/*`, `frontend/src/components/core/SortIcon.tsx` |
| Share reports | `backend/src/share/dto/reportShare.dto.ts`, `backend/src/email/email.service.ts`, `frontend/src/components/share/showReportShareModal.tsx` |
| Uploader metadata / visitors | `backend/src/utils/uploaderInfo.util.ts`, `ShareDTO.uploaderInfo`, `frontend/src/components/share/UploaderInfoBadges.tsx`, `ShareStats.tsx`; view counts stay in `Share.views`, written in five-second batches for unlimited shares and atomically for limited ones (`shareState.service.ts`). Geo labels are clamped before storage. The recent-visitor list is shown to every visitor. |
| Reverse-share use limits | `backend/src/reverseShare/reverseShare.service.ts` (`reserveUse`), `backend/src/share/share.service.ts` (reserve at create, reject invalid cookies, no refund on revert) |
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` (up to 100 image/video cards, 12-card lazy batches, single-media square card, full-size previous/next modal), `frontend/src/components/core/LazySection.tsx` |
| Individual downloads / legacy ZIP | `frontend/src/components/share/DownloadAllButton.tsx`, `frontend/src/services/share.service.ts`; `backend/src/share/share.service.ts` no longer creates archives. Existing `archive.zip` files remain served by the legacy API. |
| Share and file size limits | `backend/prisma/seed/config.seed.ts` (`share.maxSize` 5 GB, `share.maxFileSize` 512 MB), migration `20261025000000_raise_share_size_limit`, `backend/src/share/share.util.ts` (`resolveShareSizeLimit`), local/S3 upload guards, upload UI |
| Trending today / new shares | `backend/src/cache/trending.service.ts` (`getTrending`, `getTrendingCountries`, `getRecent`), `GET /api/shares/trending`, `/trending/countries`, `/recent`; `frontend/src/components/share/TrendingToday.tsx`, `TrendingCountries.tsx`, `frontend/src/pages/trending.tsx`, `frontend/src/pages/new.tsx` |
| Shared UI polish | `frontend/src/components/core/RelativeTime.tsx`, `RouteProgress.tsx`, `LazyImage.tsx`, `LazyVideo.tsx`, `LazySection.tsx`, `frontend/src/utils/filePreview.util.ts` |
| Profile pictures | `backend/prisma/schema.prisma` (`User.avatarUpdatedAt`), migration `20261028010000_add_user_avatar`, `backend/src/user/avatar.service.ts` (5 MB/40 MP limits, EXIF rotate, 256px centre-crop, metadata-stripped WebP, atomic 0600 write), `user.controller.ts` (`POST`/`DELETE /api/users/me/avatar`, public versioned `GET /api/users/:id/avatar.webp` with ETag/304), `frontend/src/components/core/UserAvatar.tsx`, `frontend/src/utils/avatar.util.ts` |
| Legal pages | `frontend/src/components/legal/LegalDocument.tsx` (one shared imprint/privacy markdown layout) |
| Upload paste and folder picks | Upstream `useClipboardPaste.hook.ts`, `file.util.ts`, `folder.util.ts`; the fork keeps only `share.maxFileSize` validation in `Dropzone.tsx`, the folder button and upload DTO bounds |
| Share thumbnails / OG | `backend/src/file/file.service.ts` (share-level 300px WebP, ordered preview fallbacks, background queue, 32-day cleanup), `backend/src/share/preview.util.ts`, `GET /api/shares/:id/thumbnail`, listing cards and `Meta.tsx` |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts`, `frontend/src/utils/version.util.ts`, `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts`, `frontend/next.config.js` |
| Per-IP+User-Agent rate limiting | `backend/src/utils/visitorIdentity.util.ts`, `backend/src/cache/valkeyThrottler.storage.ts`, `backend/src/cache/throttler.config.ts`, `backend/src/main.ts` |
| Valkey cache | `backend/src/utils/cache.util.ts`, `backend/src/share/shareState.service.ts`, `backend/src/cache/*` |
| Hot-path queries and cache fills | `shareState.service.ts` (view counters, comment-only invalidation), `share.service.ts` (SEO fill), `metrics.service.ts`, `system.service.ts`, `trending.service.ts` (recent fill), migration `20261028000000_add_relation_indexes` |
| VirusTotal background scanning | `backend/src/virustotal/*`, `backend/src/share/share.service.ts` (completion hook), `backend/src/clamscan/clamscan.service.ts` (shared malicious-share removal), `frontend/src/pages/admin/virustotal.tsx`, `backend/.env.example` |
| Site stats, referrers and footer | `backend/src/system/system.service.ts`, `backend/src/cache/metrics.service.ts`, `frontend/src/components/footer/Footer.tsx`, `frontend/src/pages/admin/referrer.tsx`, `POST /api/system/pageview` |
| Valkey metrics and error logs | `backend/src/cache/valkeyMetrics.util.ts`, `backend/src/logs/*`, `GET /api/system/valkey`, `frontend/src/components/admin/ValkeyMetricsCard.tsx`, `frontend/src/pages/admin/logs.tsx`, `frontend/src/utils/errorReporter.util.ts` |
| Home copy and ads | `frontend/src/pages/index.tsx`, `home.custom.*` keys in `en-US.ts`, `frontend/src/components/Ads.tsx` (guest-only; skipped for signed-in visitors, protected shares and reverse-share upload cookies). Upstream `useHomeHref` owns every "go home" target. |
| Fork branding / deployment | `frontend/public/img/**`, `frontend/public/favicon.ico`, `frontend/src/pages/manifest.json.tsx`, `pingvin-*.service`, `update.sh` |
| SEO / crawlers | `frontend/src/components/Meta.tsx`, `SiteStructuredData.tsx`, `frontend/src/hooks/siteMeta.hook.ts`, `frontend/src/pages/robots.txt.tsx`, `sitemap.xml.tsx`, `frontend/src/utils/seo.util.ts`, `seo.server.util.ts`, `backend/src/share/share.service.ts` (`getSeo`), `backend/src/system/system.service.ts` (disk-backed robots/sitemap) |
| WebP / image pipeline | `backend/src/file/file.service.ts` (per-file and share-level previews), `backend/src/file/file.controller.ts` (`webp=300`), `backend/src/config/logo.service.ts`, `frontend/src/utils/file.util.ts`, `frontend/src/components/Logo.tsx`, `frontend/public/img/*.webp` |

Fork-only UI strings live in `frontend/src/i18n/translations/en-US.ts`; other
locales fall back to English through `frontend/src/utils/i18n.util.ts`. New fork
strings must use new `*.custom.*` keys so other languages show the English
fallback rather than the upstream copy.

Shared fork-only backend helpers live in `backend/src/utils/`:
`keyedLock.util.ts` serializes per-share read-modify-write tasks, and
`fileWrite.util.ts` writes JSON/state files through a unique temporary file plus
atomic rename. Reuse them instead of adding another lock or temp-file block.
Public-share predicates live in `share.util.ts` (`publicShareWhere`,
`activeShareWhere`, `isPublicShare`) and must be reused by new queries.
Cross-cutting pagination, country, referrer, storage-quota and MIME logic live in
the matching `utils/*.util.ts` files.

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
   (404), trending widget, `/trending` and `/new`, file download headers, report
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
- Report notifications use `REPORT_EMAIL` from `backend/.env`, falling back to
  the configured SMTP sender.
- `backend/.env` is authoritative for the backend and systemd unit. Keep the
  live database URL exactly:
  `DATABASE_URL="file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1"`
- `DATA_DIRECTORY="/var/www/pingvin_data"`. Uploader/visitor metadata is a
  per-share `uploads/shares/<shareId>/uploader.json` (mode `600`). Sitemaps are
  written to `DATA_DIRECTORY/sitemaps/<site-hash>/` and are derived data.
- Global rate limiting is 90 requests per 60 seconds per client, identified by
  client IP + browser `User-Agent`, blocking for 60 seconds. Configure with
  `VISITOR_RATE_LIMIT`, `VISITOR_RATE_TTL_MS`, `VISITOR_RATE_BLOCK_MS`. The
  throttler hashes IP+UA with SHA-256 before storage; no visitor cookie is
  issued. The upstream per-route `THROTTLE_LIMIT` (100/min) remains. When
  `CACHE_REDIS_ENABLED=true`, both buckets live in Valkey and fall back to memory
  if it is unavailable. Config, user session, share `HEAD`, upload requests and
  file/ZIP reads skip the visitor bucket.
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
- Share page data and guard data are cached for 30 seconds; SEO for 60 seconds.
  A cold-cache burst shares one in-flight load. Cache fills are generation
  checked, so a read that started before an edit cannot restore a stale share.
  Comment mutations invalidate only the share payload; the security and SEO
  entries stay valid.
- Unlimited share views are batched into one SQLite write every five seconds
  (`VIEW_WRITE_DELAY_MS`); limited shares use one conditional
  `UPDATE ... RETURNING` so the limit check and increment cannot race. Pending
  counts are flushed on shutdown.
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
  and the robots pointer.
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

## HTTP caching

Origin responses set `Cache-Control`, `CDN-Cache-Control` and
`Cloudflare-CDN-Cache-Control` consistently (`utils/cache.util.ts`).

- Public HTML shells (`/`, `/trending`, `/new`, `/share/*`, legal pages) are
  `public, s-maxage=60, stale-while-revalidate=30, stale-if-error=300` only when
  the URL has no query string, the language is the default and the theme is
  unset or light. Authenticated, non-default-language, `?lang=`, `?recipient=`
  and other query variants stay `no-store`. Pages never put account data in
  `__NEXT_DATA__`; `_app` restores the user client-side.
- Config and OAuth availability: 30 seconds. Stats, trending, recent and share
  SEO: 60 seconds. Trending countries: 300 seconds. Comments: 24 hours with an
  app version query. Sitemap index: 1 hour. Sitemap chunks, robots and manifest:
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
  `no-store`.
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
- OAuth callbacks require state, ID tokens must have a subject and be unexpired,
  and provider IDs cannot be empty. Tokens are never logged.
- Reverse-share tokens cannot bypass `allowShare`/`maxShares`; a use is reserved
  atomically at share creation. `CreateShareGuard` is only on `POST /shares`;
  upload/complete/revert/file routes use `StrictShareOwnerGuard` so an
  in-progress upload is not rejected by the remaining-use check.
- Upload bodies use class-validator DTOs (safe names, bounded chunks/parts) and
  the service caps chunk count against `maxFileSize`/`chunkSize`. Active
  documents (HTML/SVG/XML/JS/CSS) are forced to attachment/octet-stream on
  inline reads.
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
  permanently redirects to `/share/:id`. Protected shares return only
  `{ indexable: false, id }` from the SEO endpoint and never derive labels.
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
- Unversioned comment URLs can be served from a 24-hour edge copy. The app
  always sends `?v=<commentsVersion>`; purge the comments URL to clear old
  entries.
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
trending/recent/country ranking and cache behavior, share thumbnails, sitemap
index/chunks/robots, comments, archive-encryption detection, VirusTotal
audit/queue/filter/removal/notification flows, reverse-share guard wiring,
referrers and avatars. Keep this suite green before pushing; run the frontend
production build and lint in the same pass. Playwright smoke checks should cover
guest, member and mobile views of the public pages, upload/download/comment,
admin redirects and the share gallery with zero application console errors or
warnings (the intentional 404 document status is excluded).

Live deployments are verified by the site administrator after
`/var/www/pingvin_source/update.sh`; do not run that script from an agent
session.
