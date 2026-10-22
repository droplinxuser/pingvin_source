# Fork maintenance notes

`droplinxuser/pingvin_source` is a lightly customized fork of
`smp46/pingvin-share-x`. Keep custom code out of upstream files where possible
so `git merge upstream/main` stays small.

## Custom areas

| Area | Main files |
|---|---|
| Environment loading / production config | `backend/src/constants.ts`, `backend/src/config/config.service.ts`, `backend/src/main.ts` |
| Rolling 100-day expiration | `frontend/src/utils/date.util.ts`, share create/edit modals |
| Admin pagination, search and sorting | `backend/src/share/share.service.ts`, `backend/src/user/user.service.ts`, `frontend/src/pages/admin/*` |
| Share reports | `backend/src/share/dto/reportShare.dto.ts`, `backend/src/email/email.service.ts`, `frontend/src/components/share/showReportShareModal.tsx` |
| Uploader metadata | `backend/src/utils/uploaderInfo.util.ts`, `ShareDTO.uploaderInfo`, `UploaderInfoBadges.tsx` |
| Inline media gallery | `frontend/src/components/share/MediaPreviewGallery.tsx` |
| Cache headers / hotlink protection | `backend/src/utils/cache.util.ts`, `backend/src/utils/referrer.util.ts`, `frontend/src/middleware.ts` |
| Fork branding / deployment | `frontend/public/img/**`, `pingvin-*.service`, `update.sh` |

## Merge checklist

1. `git fetch upstream && git merge upstream/main` on a branch.
2. Resolve conflicts mainly in `share.service.ts`, the share create/edit modals
   and `createShare.dto.ts` / `createReverseShare.dto.ts`.
3. Keep fork-only strings in `frontend/src/i18n/translations/en-US.ts`; other
   locales fall back to English via `i18n.util.ts`.
4. Re-check the production settings below after any config seed changes.
5. Run:
   - backend: `npm ci && npx prisma generate && npm run build`
   - frontend: `npm ci && npm run build`
6. Smoke-test local: home page, sign-in, upload, share page, admin shares/users,
   missing share (404), file download headers.

## Production settings

- `security.allowRegistration=false`
- `oauth.allowRegistration=true`
- `oauth.disablePassword=false`
- `share.maxExpiration` / `share.defaultExpiration` are intentionally removed
  from the seed; expiration is rolling and automatic.
- Report notifications use `REPORT_EMAIL` from `backend/.env`, falling back to
  the configured SMTP sender.
- `backend/.env` is authoritative for the backend and systemd unit. Keep the
  live database URL at `file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1`.
- `update.sh` runs migrations/seeding via the service restart, installs the
  systemd units, and preserves existing `.env` values.
- Cloudflare: bypass cache for `/sw.js` and purge old HTML/service-worker
  responses after deployments. Page HTML is cached for at most 60s; hashed
  `/_next/static` assets stay immutable.

## Auth redirects

Post-login, post-TOTP, post-signup and authenticated-home redirects use a
full document navigation. The public home page prefetches `/upload`, which
returns a sign-in redirect for guests; reusing that cached redirect after
login can loop between `/upload` and `/auth/signIn`.

## Known non-issues

- Backend lint reports upstream warnings only.
- A fresh data directory logs one `ENOENT` from the temporary-file cron.
- Node 24+ prints an upstream `util._extend` deprecation warning at frontend
  startup.
