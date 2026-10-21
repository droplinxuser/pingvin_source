# Fork audit: `droplinxuser/pingvin_source` vs `smp46/pingvin-share-x`

_Phase A report (read-only analysis). Date: 2026-10-16._

## Baseline

| Item | Value |
|---|---|
| Upstream default branch | `upstream/main` |
| Merge base | `b6a5e418` ("fix: reverse share access") = current `upstream/main` HEAD (fork is fully caught up) |
| Fork-only commits | 41 (incl. 6 merge commits) |
| Diff `upstream/main..HEAD` | **130 files, +3,488 / −1,375 (4,863 changed lines)**; 13 binary files |
| Of which i18n (`frontend/src/i18n/translations/*`) | 34 files, ~1,929 changed lines (≈40 % of the delta) |
| Tracked `.env` files | upstream: `backend/prisma/.env` only. Fork additionally tracks **`backend/.env`** (force-added; matches the `.env` ignore rule) |

Environment notes: local Node is **v24.20.0 / npm 11.19.0** (production: v22.23.3 / 10.9.9) — accepted by the user for Phase B/C. Neither project runs prettier as a lint rule (`eslint-config-prettier` only disables formatting rules), so re-indentation is a style matter, not a build gate.

### Key upstream mechanisms discovered (reusable instead of fork code)

1. **Registration switches already exist separately**: `security.allowRegistration` (password sign-up endpoint + hides "Sign up" links + middleware disables `/auth/signUp`), `oauth.allowRegistration` (OAuth auto-registration, checked only in `oauth.service.ts`), `oauth.disablePassword` (password sign-in/reset). The fork's auth semantic ("no password sign-up, OAuth sign-up allowed, password sign-in allowed") is reachable with **configuration only**.
2. **Seed auto-migration**: `prisma/seed/config.seed.ts` deletes DB config rows that no longer exist in the seed and refreshes `defaultValue` while preserving `value`. `loadYamlConfig` iterates the seed, so unknown yaml keys are ignored. ⇒ hiding a variable can be done by deleting it from the seed.
3. **i18n has no English fallback**: `IntlProvider` receives only the selected locale's messages; a missing key renders the raw key ID. That is why the fork copied English strings into 33 locales. `i18nUtil.getLocaleByCode()` is the single source of messages for both `_app.tsx` and `translateOutsideContext()` — a 3-line merge there gives an English fallback everywhere.
4. **Admin logo upload** (`LogoService`) writes `logo.png`, `favicon.ico` and all PWA icons into `frontend/public/img` — the exact files the fork committed as binaries.
5. `TRUST_PROXY` (backend `main.ts`), `legal.imprintUrl`/`legal.enabled`, `general.showHomePage`, `TableSortIcon` component, `CONFIG_FILE` yaml config — all already upstream and partly reused by the fork.

---

## Groups (by purpose)

Line counts are "changed lines" (added + removed) from `git diff --numstat`. Risk = likelihood of merge conflicts on future upstream merges (H/M/L).

### G1 — Deployment scaffolding & env loading

| Group | Goal | Files/lines touched | Existing upstream mechanism that could replace it | Proposed minimal refactor | Est. lines before → after | Risk |
|---|---|---|---|---|---|---|
| G1a | Run as systemd services on Ubuntu, live-update script, maintenance page | `pingvin-back.service` (+28), `pingvin-front.service` (+20), `update.sh` (+81), `5xx.html` (+1) — all new fork-only files | none (upstream is Docker-oriented) | Keep as is. Optionally add a 3-line backup/restore of `backend/.env` around `git pull` in `update.sh` (see G1c) | 130 → ~133 | L |
| G1b | Backend reads `backend/.env` (and `../.env`) so `SITE_NAME`, `DATABASE_URL`, `DATA_DIRECTORY`, `THROTTLE_LIMIT`, `REPORT_EMAIL` come from `.env` | `backend/src/constants.ts` (+10, `process.loadEnvFile`) | `@nestjs/config` is a dependency but is not used anywhere; it would load too late for `constants.ts` anyway | Keep (zero-dependency, additive, at top of file). **Required by the user's env-based config requirement.** | 10 → 10 | L |
| G1c | Production DB path always known to Prisma CLI | **`backend/.env` tracked** (+2, contains production paths), `backend/.env.example` (+22), `frontend/.env.example` (+8) | `pingvin-back.service` already exports the same variables; `update.sh` already recreates `backend/.env` if missing | **Untrack `backend/.env`** (`git rm --cached`), keep both `.env.example` files, fix the comment in `.env.example` that says the file is committed. ⚠ On the server `git pull` will delete/complain about the file → protect it in `update.sh` (backup before pull, restore after). **Needs your decision** (violates "never commit .env", but was documented as deliberate). | 32 → 30 | L |
| G1d | — (noise) | `backend/prisma/.env` (±1: trailing newline only) | — | Revert to upstream bytes | 2 → 0 | L |
| G1e | — (dead config) | `backend/package.json` `allowScripts` (+8), `frontend/package.json` `allowScripts` (+3) | Nothing consumes `allowScripts` (it is a LavaMoat key; LavaMoat is not installed; npm ignores it) | Remove both blocks | 11 → 0 | M→L (package.json is a frequent upstream conflict point) |

### G2 — Site name (`SITE_NAME`) & branding assets

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G2a | Site name from env overrides DB/yaml | `backend/src/config/config.service.ts` `applyEnvOverrides()` (+15) | `config.yaml` via `CONFIG_FILE` sets `value` the same way — but the user requires `.env`, not yaml | Keep (mirrors the yaml loader pattern; additive) | 15 → 15 | L–M |
| G2b | Placeholder default name "SiteName" | `backend/prisma/seed/config.seed.ts` appName (±1), `frontend/src/utils/defaultConfig.util.ts` (±2) | `SITE_NAME` override makes the seed default irrelevant in production | Revert both to upstream defaults (behaviour only differs when `SITE_NAME` is unset) | 6 → 0 | L |
| G2c | Branded e-mails | `config.seed.ts` 8 default templates use `{appName}` (±8 = 16 lines); `backend/src/email/email.service.ts` adds `appName` template var (+10) | Templates are admin-editable (DB `value`); the seed only refreshes `defaultValue` | Keep `{appName}` support (small, upstreamable). **Option:** also revert the 8 seed defaults and enter the templates once in the admin UI (−16 lines, needs a one-time prod action; emails would show "Pingvin Share" until done) | 26 → 26 (or 10) | L |
| G2d | PWA manifest name = site name | `frontend/src/pages/manifest.json.tsx` (+55), `frontend/public/manifest.json` (−66, must be deleted — Next forbids a public file with a page's name), `frontend/next.config.js` (+2 comment) | none (static manifest) | Keep the dynamic route; drop the `next.config.js` comment | 123 → 121 | L |
| G2e | Fork logo / favicon / PWA icons | 13 binaries under `frontend/public/img/**` + new `frontend/public/favicon.ico` | `LogoService` (admin upload) writes the same files at runtime — but the standalone build copies `public/` at build time and `git pull` would clash with runtime-modified tracked files | Keep committed (reproducible). Suggest `.gitattributes` `merge=ours` for these paths at the next upstream merge | 13 bin → 13 bin | L (binary; trivially resolved) |
| G2f | Allow search-engine indexing | `frontend/src/pages/_document.tsx` (−2 `<meta name="robots" noindex>`) | none | Keep (cannot be smaller) | 2 → 2 | L |
| G2g | — (cosmetic) | `backend/src/i18n/en-US/ldap.json` capitalisation (±1) | — | Revert (or send upstream separately) | 2 → 0 | L |

### G3 — Home page & footer copy / external links

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G3a | Custom marketing copy on `/` with `{siteName}` and `{contactEmail}`, "About" button → imprint, start button → `/upload` | `frontend/src/pages/index.tsx` (25/5), en-US `home.*` replaced (10 keys, ~24 lines), **27 locales** `home.*` replaced with English (~20 lines each ≈ 540 lines); 6 locales left untouched (so bg/ca/et/fa/nb/nn still show upstream's "self-hosted" text — inconsistent) | `legal.imprintUrl` (already used), `general.appUrl`. English fallback from G4 | Use **fork-specific message IDs** (e.g. `home.custom.*`) defined in `en-US.ts` only; `index.tsx` references them (10 one-line id changes). With G4 every language shows the same fork copy; all upstream `home.*` lines stay untouched in all 34 files. Replace `(Link as any)` with a typed solution (rule: no `any`) | ~606 → ~72 | H → L |
| G3b | Footer "Contact … for any inquiries" link instead of "Powered by Pingvin Share X" | `frontend/src/components/footer/Footer.tsx` (±6 in two branches), hard-coded `https://phc.onl/contact`, untranslated "Contact" | `legal.imprintUrl` / `legal.*` config; `footer.poweredBy` key | Keep structure; optionally read the URL from `legal.imprintUrl` and move the label into an en-US key (`footer.contact`) | 12 → 12–14 | M |

### G4 — i18n infrastructure (new, enables most i18n savings)

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G4a | Avoid copying English strings into 33 locale files for every new key | **Currently:** `footer.stats.*` (+5 ×33), `admin.shares.*` (+6 ×33), `admin.config.oauth.allowed-hosts*` (+3 ×33, upstream en-US-only key) = **~460 lines** of English duplicated across locales | `defaultLocale="en"` is already set; `i18nUtil.getLocaleByCode()` is the single messages source | Merge `{ ...LOCALES.ENGLISH.messages, ...locale.messages }` inside `getLocaleByCode()` (`frontend/src/utils/i18n.util.ts`, +3/−1). Then new fork keys live in `en-US.ts` only | 460 → 4 | L |
| G4b | — (churn) | 4 now-unused keys deleted from all 34 locales (`account.reverseShare.never-expires`, `upload.modal.expires.never`, `upload.modal.expires.never-long`, `upload.modal.completed.never-expires`) = 136 lines | Unused keys are harmless | Restore them (0 diff) | 136 → 0 | M → L |
| G4c | — (churn) | Report-feature block appended **at EOF** in 33 locales changes the last line + trailing newline (3 lines ×33 ≈ 99) and sits exactly where Crowdin appends new keys | — | Insert the `share.report.*` block mid-file (after the `/share/[shareId]` section) so EOF is untouched | 99 → 0 | H → L |
| G4d | — (cosmetic) | en-US grammar fixes ("an HTTPS", "of a user" ×2) and `admin.config.share.max-expiration.description` text (±4 lines) | — | Revert (or PR upstream) | 8 → 0 | L |

### G5 — Auth: password sign-up disabled, password sign-in kept, OAuth sign-up allowed

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G5 | Repurpose `oauth.disablePassword` to only block password *registration*; always show password sign-in + OAuth buttons; sign-up page shows OAuth buttons only | `backend/src/auth/auth.controller.ts` (+5), `auth.service.ts` (17/22, de-indents the sign-in block), `backend/src/i18n/en-US/auth.json` (+1), `frontend/src/components/auth/OAuthButtons.tsx` (+86 new), `SignInForm.tsx` (33/117), `SignUpForm.tsx` (66/37), `config.example.yaml` comment (±2) — **~387 lines, 7 files** | **Pure configuration:** `security.allowRegistration=false` (blocks `/auth/signUp` endpoint + page, hides "Sign up" links), `oauth.allowRegistration=true` (OAuth users auto-register), `oauth.disablePassword=false` (password sign-in + reset work) | Drop the entire group (revert 7 files to upstream) and set the three settings in the admin UI / yaml. **UX differences to approve:** no `/auth/signUp` page (new users click an OAuth button on the sign-in page, which registers them), no "Sign up" link in header/sign-in form; the home start button falls back to `/auth/signIn` (`signupEnabled` becomes false) unless G3a labels/links it differently | 387 → 0 | H → none |

If you prefer the current UX exactly, the group can only shrink marginally (≈387 → ~300) and keeps H risk in `SignInForm.tsx`/`auth.service.ts`.

### G6 — Automatic rolling 100-day expiration (no user-chosen expiration, no permanent shares)

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G6a | Backend: every share gets +100 days at creation and on every visit; clients cannot set/change it | `share.service.ts` (create/update/parse/validate removed, `extendExpirationOnVisit` added ≈ 69), `shareSecurity.guard.ts` (+8), `reverseShare.service.ts` (3/21), `utils/date.util.ts` (+8), `createShare.dto.ts` (3/1), `createReverseShare.dto.ts` (2/1) ≈ 115 | none | Keep. (DTO fields could stay `@IsOptional()` so upstream lines survive — already done.) | 115 → 115 | M–H (share.service.ts is hot upstream) |
| G6b | Data migration for existing shares | 2 migrations dated 2026-10-16 (+25). The first wrote TEXT dates, the second converts them back to INTEGER ms | — | Keep both **if production has already applied them** (Prisma tracks applied names). If **not yet deployed**, squash into one correct migration (−10 lines, 1 file). **Needs your answer.** | 25 → 25 (or 15) | L |
| G6c | Hide `share.maxExpiration` / `share.defaultExpiration` from admin UI & `/configs` | `config.service.ts` `HIDDEN_VARIABLES` + 2 filters (+19), `config.example.yaml` comments (±2 ×2) | Seed auto-deletes DB rows for variables removed from the seed; yaml ignores unknown keys; no code references remain (verified by grep) | Delete the two variables from `config.seed.ts` (−12) and the 4 lines from `config.example.yaml`; drop `HIDDEN_VARIABLES` entirely. Same visible behaviour, one fewer upstream method touched | 23 → 16 | M → L |
| G6d | Remove expiration UI | `showCreateUploadModal.tsx` (−146), `showCreateReverseShareModal.tsx` (1/133), `showShareInformationsModal.tsx` (−67), `showCompletedUploadModal.tsx` (−14), `account/{shares,received,reverseShares}.tsx` (−38), `upload/index.tsx` (−4), `share/[shareId]/index.tsx` (−3), `ManageShareTable.tsx` (−1), `types/share.type.ts` (1/2), `services/share.service.ts` `createReverseShare` (−2) ≈ 411 | — | Inherent (deleting UI = deleting lines). **Optional 0-diff restorations (behaviour change, your call):** read-only "Expires at" columns in the three account tables (+38 back) and the "This share will expire on …" line in the completed-upload modal (+14 back) — both would now show the real rolling date | 411 → 411 (or 359) | H (large deletions in frequently edited modals) |
| G6e | — (churn) | `frontend/src/utils/date.util.ts` `getExpirationPreview` removed (−32) although unused exports are harmless; i18n key removals (see G4b) | — | Restore `getExpirationPreview` (0 diff) | 32 → 0 | L |

### G7 — Admin tables: pagination, search, sorting, share deletion, list cap removal

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G7a | Paginated/sortable/searchable `GET /shares/all` and `GET /users` | `share.controller.ts` (+27), `share.service.ts` (+70), `user.controller.ts` (22/2), `user.service.ts` (58/2), `utils/pagination.util.ts` (+10 new) | none (upstream returns full lists) | Keep. Response shape change (`{shares,total,page,pageSize}`) is inherent | 189 → 189 | M |
| G7b | Admin UI pagination/search/sort | `pages/admin/shares.tsx` (104/20), `pages/admin/users.tsx` (34/9), `ManageShareTable.tsx` (38/6), `ManageUserTable.tsx` (50/6), `services/share.service.ts` `list` (+21), `services/user.service.ts` (11/2), `_app.tsx` wider container for `/admin/shares` (7/1) | `TableSortIcon` + `<Group spacing="xs">` pattern (reused, consistent with `FileList.tsx`) | Keep. `_app.tsx` change could be avoided by horizontal scrolling inside the page (layout change — optional) | 309 → 309 | M |
| G7c | Admin "delete" button on the share page | `share/[shareId]/index.tsx` (+45), key `admin.shares.notify.deleted` | `shareService.remove`, existing `admin.shares.edit.delete.*` keys (reused) | Keep | 45 → 45 | M |
| G7d | New UI strings | `admin.shares.{empty,search.placeholder,search.empty,search.clear,notify.deleted}` ×34 locales (English everywhere) ≈ 204 | G4 fallback; `account.reverseShares.table.no-shares` could serve as the empty-state text | en-US only (G4) | 204 → 6 | H → L |

### G8 — Share report feature (`POST /shares/:id/report` → e-mail to admin)

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G8a | Backend endpoint + mail | `share/dto/reportShare.dto.ts` (+24 new), `share.controller.ts` (+14), `share.service.ts` `report()` (+25), `email.service.ts` `sendShareReportEmail` (+37, `REPORT_EMAIL` env fallback to `smtp.email`), `i18n/en-US/email.json` (+4) | `EmailService.sendMail`, `Throttle`, i18n `email.*` (all reused) | Keep (additive) | 104 → 104 | L–M |
| G8b | Frontend modal + button | `showReportShareModal.tsx` (+116 new), `services/share.service.ts` (+6), `share/[shareId]/index.tsx` (+13) | — | Keep | 135 → 135 | L |
| G8c | Translations | `share.report.*` 17 keys ×34 locales (real translations, ≈646 lines) + EOF churn (G4c) | G4 fallback | Keep translations but move the block mid-file (G4c). **Option:** English-only (en-US) → −561 lines / −33 files | 745 → 646 (or 85) | H → M |

### G9 — Caching / CDN (Cloudflare) headers, hotlink protection, real client IP

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G9a | Only serve downloads when `Referer` is the app; cache public downloads at the edge, never cache authenticated ones or redirects | `backend/src/file/file.controller.ts` (122/5: 4 private helpers ≈ 70 lines + call sites ≈ 50) | `ConfigService.get("general.appUrl")` (used) | Move the 4 helpers to a new `backend/src/utils/downloadCache.util.ts` (pure functions taking `appUrl`); controller keeps only the call sites | 127 → ~55 in upstream file (+~75 new file) | H → M |
| G9b | Share API never cached | `share.controller.ts`: 2 × 5 `@Header()` decorators (+16) | `applyDecorators` (NestJS) | New `NoStore()` composed decorator (new util file); controller gets `@NoStore()` ×2 + 1 import | 17 → 3 (+~10 new) | M → L |
| G9c | Share pages never cached (SSR) | `frontend/src/utils/antiCache.util.ts` (+19 new), `pages/s/[shareId].ts` (+4), `share/[shareId]/{index,edit}.tsx` (+3 each) | — | Keep | 29 → 29 | L |
| G9d | Forward the real `X-Forwarded-For` chain to the backend | `frontend/src/pages/api/[...all].tsx` (6/1) | `TRUST_PROXY` backend flag (used by the systemd unit) | Keep (bug fix, upstreamable); trim the 2-line comment to 1 | 7 → 5 | L |
| G9e | Configurable rate limit | `backend/src/app.module.ts` `THROTTLE_LIMIT` (±1) | — | Keep | 2 → 2 | L |

### G10 — Inline media gallery & MIME fixes

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G10a | Embedded image/video/audio cards above the file list | `MediaPreviewGallery.tsx` (+252 new), `FilePreview.tsx` exports context & players (14/6), `share/[shareId]/index.tsx` (+6), `fileSize.util.ts` `MAX_INLINE_FILE_SIZE` (+3), `FileList.tsx` size guard (6/2) | `FilePreview` players (reused via exports) | Keep | 289 → 289 | L–M |
| G10b | `.mov` inline playback as `video/mp4`; extra MIME overrides | backend `utils/mime.util.ts` (+10 new), `file.controller.ts` (2/2), `s3.service.ts` (+8); frontend `services/share.service.ts` (+62), `showFilePreviewModal.tsx` (±2) | `mime-types` — frontend ships an older `mime-db` than the backend | Keep. **Option:** bump frontend `mime-types`/`mime-db` instead of the 12-entry override table (dependency change → needs approval) | 86 → 86 | L–M |
| G10c | Hide "Download all" until the zip is ready (instead of a toast) | `DownloadAllButton.tsx` (10/17 restructure) | — | `if (!isZipReady) return null;` before the upstream `return` (+1 line; the toast branch becomes unreachable but keeps upstream lines intact) | 27 → 2 | M → L |

### G11 — Site statistics in footer & public view count

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G11a | `GET /system/stats` (cached 60 s) | `system/dto/systemStats.dto.ts` (+7 new), `system.controller.ts` (+6), `system.service.ts` (50/2) | `CACHE_MANAGER`, Prisma counts (reused) | Keep | 65 → 65 | L |
| G11b | Footer shows users/shares/files/storage | `Footer.tsx` (+24), `services/system.service.ts` (13/1), `footer.stats.*` ×34 (≈170) | G4 | en-US only (G4) | 207 → 42 | M → L |
| G11c | View count visible to visitors | `share/dto/share.dto.ts` (+3), `types/share.type.ts` (+1), `share/[shareId]/index.tsx` (+9), en-US `share.viewCount` (+1) | `MyShareDTO.views` already exists for owners | Keep (`defaultMessage` already used — consistent with G4) | 14 → 14 | L |

### G12 — Ads

| Group | Goal | Files/lines touched | Existing upstream mechanism | Proposed minimal refactor | Before → after | Risk |
|---|---|---|---|---|---|---|
| G12 | Ad units on share page and 404 | `components/Ads.tsx` (+45 new, hard-coded publisher script URLs), `pages/404.tsx` (+2), `share/[shareId]/index.tsx` (+2) | none | Keep. Optional: read script URLs from `NEXT_PUBLIC_AD_SCRIPTS` (not required for diff size — the file is fork-only) | 49 → 49 | L |

---

## Changes that should be removed entirely (dead, redundant, or pure churn)

| # | Change | Why | Lines saved |
|---|---|---|---|
| R1 | `allowScripts` blocks in `backend/package.json` and `frontend/package.json` | Nothing reads them (no LavaMoat); `package.json` is a frequent conflict file | 11 |
| R2 | `backend/prisma/.env` trailing-newline change | Pure whitespace | 2 |
| R3 | `backend/src/i18n/en-US/ldap.json` capitalisation, en-US grammar fixes, `admin.config.share.max-expiration.description` rewording | Cosmetic edits to upstream text; variable will be removed anyway (G6c) | ~10 |
| R4 | `frontend/next.config.js` comment | Comment only | 2 |
| R5 | Deleted i18n keys (4 × 34) and deleted `getExpirationPreview()` | Unused code/keys are harmless; deleting them only creates conflicts | 168 |
| R6 | English copies of `footer.stats.*`, `admin.shares.*`, `admin.config.oauth.allowed-hosts*` in 33 locales | Replaced by the G4 English fallback | ~460 |
| R7 | `home.*` English replacement in 27 locales | Replaced by fork-specific keys in en-US (G3a) | ~540 |
| R8 | **Whole auth group (G5)** | Replaced by three existing config switches | 387 |
| R9 | `HIDDEN_VARIABLES` logic in `config.service.ts` | Replaced by deleting the two seed variables (G6c) | 19 (net −7 after seed deletion) |
| R10 | `(Link as any)` in `index.tsx` | Violates the no-`any` rule; replace with a typed construct | 0 (quality) |
| R11 | Tracked `backend/.env` | Violates "never commit .env"; systemd unit + `update.sh` already cover it (**decision needed**) | 2 |

## Changes that cannot be reduced (and why)

- **G6a/G6d expiration removal** — removing a feature means deleting upstream UI code; keeping dead UI hidden behind flags would be hackier and still conflict. Only the optional read-only restorations (tables / completed modal) can trade behaviour for diff size.
- **G7 admin pagination/sorting** — new API contract and UI state; already reuses `TableSortIcon`. Inherent.
- **G8 report feature** — additive new feature; translations are real content.
- **G9 header logic** — inherent, but can be *relocated* out of upstream files (G9a/G9b) to cut conflict exposure.
- **G10 gallery, G11 stats, G12 ads** — additive new files; small hooks in upstream files are already minimal.
- **Binary branding assets** — must differ from upstream by definition.
- **`constants.ts` env loader, `applyEnvOverrides`, `THROTTLE_LIMIT`** — required by the "configured through `backend/.env`" requirement.
- **Migrations** — already created; whether they can be squashed depends on production state (G6b).

## Outcome (measured on branch `refactor/minimize-fork-diff`)

| | Before (`main`) | Estimated | **Actual** |
|---|---|---|---|
| Changed lines (`+`/`−`) vs `upstream/main` | 4,863 (+3,488 / −1,375) | ≈ 2,500 | **2,747 (+2,128 / −619)**, of which 253 are this document → **2,494 code lines (−49 %)** |
| Files touched | 130 | ≈ 85 | **86** (21 added, 64 modified, 1 deleted) — i18n: 34 → 1 file |
| Upstream files with H conflict risk | ~12 | ~5 | 5 (`share.service.ts`, `showCreateUploadModal.tsx`, `showCreateReverseShareModal.tsx`, `showShareInformationsModal.tsx`, `share/[shareId]/index.tsx`) |

Commits on the branch (one per group): `docs` → `chore: revert cosmetic no-op changes` → `refactor(home)` → `refactor(i18n)` → `refactor(auth)` → `refactor(share)` (expiration) → `refactor(branding)` → `refactor(file)` (cache/referrer helpers) → `refactor(share)` (DownloadAllButton) → `chore(deploy)` → `fix(config)`.

## Findings during the runtime test (Phase C)

Both fixed on the branch (approved by the user, commit `fix(config)`), both **pre-existing** on `main`:

1. **`backend/.env` was not honoured for `DATABASE_URL` at runtime.** `@prisma/client` runs dotenv on `prisma/.env` when it is first imported, and in `prisma.service.ts` that import runs before the fork's `constants.ts` loader; since existing variables win, the runtime silently used `prisma/.env`'s default database whenever no real `DATABASE_URL` variable was set (production was unaffected because the systemd unit exports it). Fix: `main.ts` imports `./constants` first. Verified: `node dist/src/main` with no environment variables now starts against the `.env` database.
2. **`SITE_NAME` was lost after any admin config change** until the next restart, because upstream's `ConfigService.update()` reloads all variables from the database. Fix: re-apply the env override after the reload. Verified via a config `PATCH`.

Not caused by the fork (left untouched):
- `backend` lint reports 1 pre-existing error in upstream's `adminNotice.service.ts` (unused import) and 16 warnings in upstream code; the `npm run lint` script itself does not run on Windows because of POSIX quoting (`eslint 'src/**/*.ts'`) — `npx eslint "src/**/*.ts"` was used instead.
- Upstream's midnight cron `deleteTemporaryFiles` logs `ENOENT` once on a fresh data directory (before the first upload).
- Node 24 only: `util._extend` deprecation warning from a frontend dependency at startup.

## Next upstream merge — suggestions

1. `git fetch upstream && git merge upstream/main` on a branch; expect conflicts mainly in `backend/src/share/share.service.ts`, the two create modals, `showShareInformationsModal.tsx` and `frontend/src/pages/share/[shareId]/index.tsx`.
2. For the 13 branding binaries add a `.gitattributes` with `merge=ours` (e.g. `frontend/public/img/logo*.png merge=ours`, `frontend/public/img/icons/* merge=ours`, `frontend/public/*favicon.ico merge=ours`) and `git config merge.ours.driver true`, so upstream logo changes never need manual resolution.
3. New fork UI strings go to `en-US.ts` only (other locales fall back to English); never append at the end of the locale files (Crowdin appends there).
4. If upstream touches `FileController.getFile`/`getZip`, only the four short call-site hunks need re-applying — the logic lives in `src/utils/cache.util.ts` and `src/utils/referrer.util.ts`.
5. Re-run `docs/fork-audit.md`'s "Production settings" check after the merge (seed changes upstream could re-introduce defaults).
6. Consider upstreaming: `{appName}` e-mail template variable, `X-Forwarded-For` passthrough in `pages/api/[...all].tsx`, `THROTTLE_LIMIT`, the English i18n fallback, and the two `fix(config)` changes.

## Decisions (approved by the user, 2026-10-16)

| # | Topic | Decision |
|---|---|---|
| 1 | G5 auth | **Configuration only.** Revert the 7 auth files to upstream. Production must set `security.allowRegistration=false`, `oauth.allowRegistration=true`, `oauth.disablePassword=false` (admin UI → Security / OAuth). |
| 2 | G1c `backend/.env` | **Untrack** (`git rm --cached`); `update.sh` backs the file up around `git pull` and restores it. |
| 3 | G6b migrations | Both `20261016…` migrations are **already applied in production → keep both untouched**. |
| 4 | G6c hidden variables | **Delete** `share.maxExpiration` / `share.defaultExpiration` from the seed (rows auto-deleted); drop `HIDDEN_VARIABLES`. |
| 5 | G6d restorations | **Restore** read-only "Expires at" columns (account shares/received/reverse shares), the info-modal "Expires at" line and the completed-upload "expires on" text. They now show the real rolling date. |
| 6 | G8c report strings | **English only** (`en-US.ts`); the 33 translated blocks are dropped (English fallback via G4). |
| 7 | G2c e-mail templates | **Revert the 8 seed defaults** to upstream; keep `{appName}` template support. Templates are entered once in the admin UI (texts listed under "Production settings" below). |
| 8 | G3a home copy | Fork keys `home.custom.*` in `en-US.ts` only. The start button **always links to `/upload`** (preserves current production behaviour); the now-dead `signupEnabled` state is removed. |
| 9 | G10b mime-db | **No bump.** Verified: even `mime-db@1.54.0` lacks `jfi`, `jif`, `j2k`, `ogm`, `3gpp2`, maps `ogx` → `application/ogg` and `jfif` → `image/pjpeg`, so the override table is still required. |

## Production settings to apply after deploying the refactor

These replace code that was removed. Apply them in the admin UI (or `config.yaml`) **before or right after** the first deploy of the refactored branch:

| Setting (admin UI) | Value | Replaces |
|---|---|---|
| Security → Allow registration (`security.allowRegistration`) | **off** | fork's "password registration disabled" check and OAuth-only sign-up page |
| OAuth → Allow registration (`oauth.allowRegistration`) | **on** | — (OAuth users are auto-registered from the sign-in page) |
| OAuth → Disable password login (`oauth.disablePassword`) | **off** | fork's "always allow password sign-in" change |
| E-mail → templates (8 fields) | see below | fork's `{appName}` seed defaults |

E-mail templates (paste as-is; `{appName}` is resolved to the configured site name):

| Field | Text |
|---|---|
| Share recipients message | `Hey!\n\n{creator} ({creatorEmail}) shared some files with you. You can view or download the files with this link: {shareUrl}\n\nThe share will expire {expires}.\n\nNote: {desc}\n\nShared securely with {appName}` |
| Reverse share message | `Hey {name}!\n\nA share was just created with your reverse share link: {shareUrl}\n\nShared securely with {appName}` |
| Reset password subject | `{appName} password reset` |
| Reset password message | `Hey {name}!\n\nYou requested a password reset. Click this link to reset your password: {url}\nThe link expires in an hour.\n\n{appName}` |
| Invite subject | `{appName} invite` |
| Invite message | `Hey {name}!\n\nYou were invited to {appName}. Click this link to accept the invite: {url}\n\nYou can use the email "{email}" and the password "{password}" to sign in.\n\n{appName}` |
| Share download notification message | `Hey!\n\n{recipientEmail} downloaded {fileName} from your share: {shareUrl}\n\n{appName}` |
| Verification subject | `Verify your {appName} account` |
| Verification message | `Hey {name}!\n\nYou just signed up for {appName}. Click this link to verify your account: {url}\n\nThe link expires in 24 hours.\n\n{appName}` |

Until the templates are entered, e-mails use upstream's default texts ("Pingvin Share").

`backend/.env` on the server: it stays on disk, but the first `git pull` that removes it from the index would delete or refuse to overwrite it — the updated `update.sh` backs it up before the pull and restores it afterwards.

---

## Running checklist

### Phase A — Analysis
- [x] Environment verified (git 2.53, Node 24 ⚠, npm 11 via `npm.cmd`)
- [x] `upstream` remote present, fetched with tags; default branch = `main`
- [x] Merge base and fork-only commit list collected
- [x] Every hunk read (code diff 4,839 patch lines; i18n diff 3,770 patch lines)
- [x] Groups and refactor proposals written (this document)
- [x] User approval of the proposals / answers to the decisions above

### Phase B — Refactor (branch `refactor/minimize-fork-diff`, one commit per group)
- [x] R1–R4: revert churn (package.json `allowScripts`, prisma/.env, ldap.json, next.config comment)
- [x] G3: fork-specific home keys; `/upload` start button; typed `Link` instead of `(Link as any)`
- [x] G4: English fallback in `i18n.util.ts`; 33 locales restored to upstream; en-US cleaned (unused keys restored, grammar edits reverted, report block moved mid-file)
- [x] G5: auth files reverted to upstream; config switches documented
- [x] G6: seed deletion instead of `HIDDEN_VARIABLES`; yaml lines removed; read-only expiry displays + `getExpirationPreview` restored; migrations kept
- [x] G2: placeholder defaults and e-mail template defaults reverted; `{appName}` support kept
- [x] G9: `cache.util.ts` / `referrer.util.ts` + `NoStore()` decorator; controllers keep call sites only
- [x] G10c: `DownloadAllButton` early return
- [x] G1: `backend/.env` untracked; `update.sh` backup/restore; `.env.example` wording
- [x] `fix(config)`: `.env` loaded before `@prisma/client`; `SITE_NAME` re-applied after config edits
- [x] Backend: `npm ci`, `npx prisma generate`, `npm run build` ✔, eslint ✔ (only the pre-existing upstream error, see Findings)
- [x] Frontend: `npm ci`, `tsc --noEmit` ✔, `next lint` ✔, `next build` ✔

### Phase C — Local runtime test (temporary DB `backend/data/local-test.db`, production-like standalone frontend)
- [x] Home page shows `SITE_NAME` ("Fork Test Site") in title, header, hero and dynamic `/manifest.json`; fork copy via `home.custom.*`
- [x] Sign up (first user = admin), sign out, password sign-in with upstream form; `/auth/signUp` disabled and "Sign up" links hidden with `security.allowRegistration=false`
- [x] Create share (no expiration controls) → 2 files uploaded → `/s/:id` → share page: view counter, media gallery (image), Report modal, Download all after zip ready, admin delete button
- [x] Downloads: 200 with `Cache-Control: private` (authenticated) / `public, max-age=3600` + `CDN-Cache-Control` (anonymous); no-referrer request redirected (hotlink protection); share API `no-store` headers; rolling expiration extended on visit
- [x] Report endpoint wired (`500 "No email address is configured…"` without SMTP, as designed)
- [x] Account shares / reverse shares / share info modal show the restored read-only expiry (100-day date); reverse share created without `shareExpiration`
- [x] Admin: users + shares tables (search, sort, pagination API), share config category without expiration settings, 404 page with ad units
- [x] Browser console: no errors except upstream's normal 403 token handshake; backend log clean except upstream's fresh-install cron `ENOENT`
- [x] Temporary DB/uploads deleted, `backend/.env` restored (untracked, production content)
- Not testable locally: OAuth provider sign-in/auto-registration, SMTP delivery (report + templates), S3 storage path, Cloudflare edge caching, `update.sh` on the server, production migration state

### Phase D — Push
- [x] `git status` clean; `git diff --stat upstream/main..HEAD` = 86 files, +2,128 / −619 (see Outcome)
- [x] `git push -u origin refactor/minimize-fork-diff` (no force push, never to `main`) — PR: https://github.com/droplinxuser/pingvin_source/pull/new/refactor/minimize-fork-diff
- [x] Final summary delivered in the session
