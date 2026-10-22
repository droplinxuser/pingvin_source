# Fork maintenance notes

`droplinxuser/pingvin_source` is a lightly customized fork of
`smp46/pingvin-share-x`. Keep custom code out of upstream files where possible
so `git merge upstream/main` stays small.

## Custom areas

| Area | Main files |
|---|---|
| Environment loading / production config | `backend/src/constants.ts`, `backend/src/config/config.service.ts`, `backend/src/main.ts`, `backend/.env.example` |
| Rolling 100-day expiration | `backend/src/utils/date.util.ts`, migrations `20261016000000` / `20261016000001`, share create/edit modals |
| Admin pagination, search and sorting | `backend/src/share/share.service.ts`, `backend/src/user/user.service.ts`, `frontend/src/pages/admin/*`, `frontend/src/components/core/SortIcon.tsx` |
| Share reports | `backend/src/share/dto/reportShare.dto.ts`, `backend/src/email/email.service.ts`, `frontend/src/components/share/showReportShareModal.tsx` |
| Uploader metadata / visitors | `backend/src/utils/uploaderInfo.util.ts`, `ShareDTO.uploaderInfo`, `frontend/src/components/share/UploaderInfoBadges.tsx`, `ShareStats.tsx`; view counts stay in `Share.views` |
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` reuses `FilePreview.tsx` |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts`, `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts`, `frontend/next.config.js` |
| Site stats and footer | `backend/src/system/system.service.ts`, `frontend/src/components/footer/Footer.tsx` |
| Home copy and ads | `frontend/src/pages/index.tsx` (upstream layout), `home.custom.*` keys in `en-US.ts`, `frontend/src/components/Ads.tsx` |
| Fork branding / deployment | `frontend/public/img/**`, `frontend/src/pages/manifest.json.tsx`, `pingvin-*.service`, `update.sh` |

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
   headers, report modal and the dynamic `/manifest.json`.

## Production settings

- `security.allowRegistration=false`
- `oauth.allowRegistration=true`
- `oauth.disablePassword=false`
- `share.maxExpiration` / `share.defaultExpiration` are intentionally removed
  from the seed; expiration is rolling and automatic.
- Report notifications use `REPORT_EMAIL` from `backend/.env`, falling back to
  the configured SMTP sender.
- `backend/.env` is authoritative for the backend and systemd unit. Keep the
  live database URL exactly:
  `DATABASE_URL="file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1"`
- `DATA_DIRECTORY="/var/www/pingvin_data"`; uploader/visitor metadata is stored
  per share at `uploads/shares/<shareId>/uploader.json` with mode `600`. View
  counts live in `Share.views`; `npm run sync:views` (run by `update.sh`) moves
  legacy counts out of `uploader.json` once and removes the old field.
- `update.sh` pulls origin/main, preserves `backend/.env`, reinstalls and
  rebuilds both packages, syncs legacy view counts, installs the systemd units,
  runs migrations/seeding through the backend restart, and restarts the
  frontend. It must run as root:
  `sudo bash /var/www/pingvin_source/update.sh`.
- Keep an up-to-date database copy at `/home/rt/Documents/pingvin-share.db`
  (`sqlite3 ... "PRAGMA integrity_check;"` must return `ok`).
- Cloudflare: bypass cache for `/sw.js` and purge old HTML/service-worker
  responses after deployments. Page HTML is cached for at most 60s; hashed
  `/_next/static` assets stay immutable.

## Auth redirects

Post-login, post-TOTP, post-signup and authenticated-home redirects use a
full document navigation. The public home page prefetches `/upload`, which
returns a sign-in redirect for guests; reusing that cached redirect after
login can loop between `/upload` and `/auth/signIn`.

## Verified locally

- Node `22.23.3` / npm `10.9.9` (same as the live server): `npm ci` and
  production builds pass for backend and frontend.
- View-count refactor: `npm run test:unit` passes; a throwaway database
  verified DB-backed views, file access on the last permitted max-view, token
  rejection after the limit, and the legacy `uploader.json` view sync.
- Backend started with `npm run prod` against a copy of
  `/home/rt/Documents/pingvin-share.db`; migrations were already current and
  the seed completed. The source backup passes `PRAGMA integrity_check`.
- Browser tests (48 guest/user/admin checks plus 24 security/reverse-share
  checks): home, guest + password sign-in, upload, file and ZIP downloads,
  text and image previews, inline gallery, uploader badges, share report
  (including SMTP delivery), password-protected share, reverse share upload,
  admin shares (search/sort/pagination), admin users (sort/pagination), admin
  delete, missing-share/unknown-route 404s, language fallback, dynamic
  manifest, site stats footer and service-worker registration.
- Live `https://dropmb.com` check (18 checks): guest home/share/404/manifest
  and the `thuoct222026` account sign-in, session, account and reverse-share
  pages pass without JavaScript errors.
- `bash -n update.sh` passes; its env writer produces the exact live
  `DATABASE_URL` above.

## Known non-issues

- Backend lint reports upstream warnings only.
- A fresh data directory logs one `ENOENT` from the temporary-file cron.
- Chrome logs the expected `403` while the share page fetches its share token,
  and `404`s for intentionally missing shares. These are network status logs,
  not JavaScript exceptions; the page recovers and renders normally.
- Node 24+ prints an upstream `util._extend` deprecation warning at frontend
  startup.
