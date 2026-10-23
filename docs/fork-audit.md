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
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` (up to 30 supported image/video thumbnails at 250px, opening `FilePreview.tsx` in the full-size modal) |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts` (shared `Cache-Control`, `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, public-file `ETag`), `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts`, `frontend/next.config.js` |
| Per-visitor rate limiting | `backend/src/utils/visitorIdentity.util.ts`, `backend/src/cache/valkeyThrottler.storage.ts`, `backend/src/cache/throttler.config.ts`, `backend/src/main.ts` |
| Valkey/Redis cache | `backend/src/utils/cache.util.ts`, `backend/src/share/shareState.service.ts`, `backend/src/cache/cache.module.ts`, `backend/src/cache/valkey.service.ts` |
| Site stats and footer | `backend/src/system/system.service.ts`, `backend/src/cache/metrics.service.ts`, `frontend/src/components/footer/Footer.tsx`; `POST /api/system/pageview` |
| Home copy and ads | `frontend/src/pages/index.tsx` (upstream layout), `home.custom.*` keys in `en-US.ts`, `frontend/src/components/Ads.tsx` |
| Fork branding / deployment | `frontend/public/img/**`, `frontend/public/favicon.ico`, `frontend/src/pages/manifest.json.tsx`, `pingvin-*.service`, `update.sh` |

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
   shares/users (search, sort, pagination), missing share (404), file download
   headers, report modal, footer page-view/top-country metrics, and the
   dynamic `/manifest.json`. Repeat once with Valkey stopped to confirm the
   fallbacks.

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
  counts live in `Share.views` and are updated directly in SQLite.
- Global rate limiting is 90 requests per 60 seconds per visitor, blocking for
  60 seconds after the limit. Configure it with `VISITOR_RATE_LIMIT`,
  `VISITOR_RATE_TTL_MS` and `VISITOR_RATE_BLOCK_MS`. Guests use a signed,
  HttpOnly `pingvin_visitor` cookie; signed-in users use their account ID;
  cookie-less/forged-cookie requests fall back to the client IP. The existing
  per-route/per-IP `THROTTLE_LIMIT` limiter remains in place. When
  `CACHE_REDIS_ENABLED=true`, both limiter buckets are stored atomically in
  Valkey (shared across instances/restarts); if Valkey is unavailable they
  fall back to the in-memory store. `/api/configs`, share `HEAD` checks and
  every upload request (init, chunk, complete, abort) skip the visitor bucket
  so SSR and large uploads keep working.
- Valkey/Redis is optional but recommended: set `CACHE_REDIS_ENABLED=true` and
  `CACHE_REDIS_URL=redis://127.0.0.1:6379` in `backend/.env` (`update.sh`
  enables both automatically when a local `valkey-server` is active). Share-page
  data, guard data and metadata are cached for 30s/30s/5s. A data-cache miss
  also resets the rolling expiration to 100 days. Share views and visitor
  metadata are written directly to SQLite and `uploader.json` on each view;
  shares without a view limit use a single atomic update instead of a
  transaction.
- The footer posts to `POST /api/system/pageview` on every rendered page. The
  endpoint increments a per-hour Valkey hash atomically (one total field plus
  one field per country), expires each hourly bucket after 25 hours and reads
  the last 24 hours of page views plus the top five countries. The aggregate is
  cached in-process for 10s so a page view costs one increment instead of 24
  hash reads. Only the 24 hourly hashes are stored; no per-visitor sets are
  kept. The POST response is never cached. `GET /api/system/stats` remains a
  read-only fallback and is edge-cacheable for 60s; its user/share/file/storage
  totals are fetched in one SQL query and cached for 60s.
- `GET /api/configs` is edge-cacheable for 30s and the server-side
  `fetchConfig` helper keeps a 30s in-process copy (5s for bundled defaults),
  so middleware and SSR do not call the backend on every page. Anonymous HTML
  shells for `/`, `/share/*`, `/imprint` and `/privacy` are edge-cacheable for
  60s with stale-while-revalidate; authenticated, non-default-language and
  `?lang=` responses are `no-store`. Public files are cached for a day with an
  `ETag`; protected files are `private`.
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
  frontend. It must run as root:
  `sudo bash /var/www/pingvin_source/update.sh`.
- Keep an up-to-date database copy at `/home/rt/Documents/pingvin-share.db`
  (`sqlite3 ... "PRAGMA integrity_check;"` must return `ok`).
- Cloudflare: bypass cache for `/sw.js` and purge old HTML/service-worker
  responses after deployments. Page HTML is cached for at most 60s; hashed
  `/_next/static` assets stay immutable, and `/img` assets use a one-day TTL
  so admin logo changes appear without a purge.

## Auth redirects

Post-login, post-TOTP, post-signup and authenticated-home redirects use a
full document navigation. A client-side navigation can reuse a prefetched
sign-in redirect for a protected page and loop between `/upload` and
`/auth/signIn`; the full navigation avoids that cache.

## Verified locally

- Node `22.23.3` production builds pass for backend and frontend. `npm run
  test:unit` passes all 12 tests, covering view limits, visitor identity,
  throttler fallback, uploader metadata and page-view metrics. A local smoke
  run rechecked config/stats cache headers, share `HEAD`/token/view flow and
  rolling expiration; the aggregate cache and upload-throttle exemptions were
  reviewed without a live Valkey instance.
- The gallery was verified with a 40-file fixture: 30 cards from 35 supported
  files, 250px media boxes, unsupported formats excluded, video first-frame
  thumbnails rendered, and image/video thumbnails opened the full-size modal.
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
  `403` responses; the visitor limiter returns `429` after 90 requests and the
  hotlink guard redirects direct file requests to the share page. With the
  backend stopped, the frontend still renders the home page from its bundled
  default config.
- The current sandbox ran without Valkey, so the in-memory page-view and
  throttler fallbacks were exercised.
- The live deployment was audited as a guest and as a test admin account:
  home, sign-in, upload, account pages, public/password/max-view/multi-file
  share pages, ZIP download, report modal, 404s, dynamic manifest,
  imprint/privacy and admin redirects. No console errors or broken assets;
  390px mobile and dark mode showed no horizontal overflow. Temporary QA shares
  were removed after the run.
- Reset-password pages now set a browser title, and a missing local
  `archive.zip` returns `404` instead of `500` (both verified locally).
- `bash -n update.sh` passes; its env writer produces the exact live
  `DATABASE_URL` above.

## Known non-issues

- Backend lint reports upstream warnings only.
- A fresh data directory logs one `ENOENT` from the temporary-file cron.
- Chrome may log the expected `403` while a protected share page fetches its
  share token, and `404`s for intentionally missing shares. These are network
  status logs, not JavaScript exceptions; the page recovers and renders
  normally. Public shares no longer make the token request.
- Node 24+ prints an upstream `util._extend` deprecation warning at frontend
  startup.
