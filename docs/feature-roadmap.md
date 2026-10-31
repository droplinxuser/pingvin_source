# Feature roadmap: what to borrow from gofile.io and bunkr.cr

This note compares the fork's current feature set with the two reference
sites and ranks the gaps that are worth closing. It is intentionally written
from the perspective of an operator who values low maintenance, upstream
alignment, privacy and search traffic — not of a site that copies every
growth hack of an ad-funded host.

The short version: the site already wins on the things that make people leave
gofile and bunkr (no forced wait, no fake download page, no account required,
expiring links, comments, reverse shares, password/view limits, malware
scanning, galleries and SEO). The creator-workflow items (search, bulk
selection, streamed downloads, download analytics) are now in place; the main
remaining gap is the **public API**.

## Current comparison

| Capability | gofile.io | bunkr.cr | This instance |
|---|---|---|---|
| Share without an account | Yes | No (uploader account) | Yes (configurable) |
| Storage limit | Advertised unlimited | Album quotas / paid tiers | 5 GB per share, 512 MB per file |
| Link lifetime | Inactivity based | Long-lived albums | Rolling 100 days, auto-extended on view |
| Direct file links | Yes | Yes | Yes (short `/d/:shareId/:fileId` link, hotlink check kept) |
| Password / visitor limit | Password | Password | Password, view limit, recipient-only |
| Receive files from others | Limited | No | Reverse shares (stronger) |
| Gallery / inline streaming | Basic preview | Core experience | Image/video gallery, PDF/text/audio preview |
| Comments | No | Limited | Yes, plain-text, moderated by owner/admin |
| Search inside a share | No | Yes (album search) | Yes (client-side) |
| Search across public content | No | Yes | Yes (Valkey index, `/search`) |
| Bulk download | Folder download | Album download | Streamed ZIP (up to `share.maxZipSize`) with per-file fallback |
| Upload from URL | Yes | Yes | Yes (server-resolved file hosts, yt-dlp media import for allowlisted platforms, browser-fetched otherwise) |
| Public API | Yes (token) | Community/unofficial | No |
| Per-file analytics | Basic | Views/downloads | Share views + rolling download counters (public) |
| Malware scanning | No | No | ClamAV + VirusTotal, background queue |
| Abuse reporting | Minimal | Minimal | Report modal + email routing |
| SEO / social cards | Weak | Weak | Canonicals, OG/Twitter, JSON-LD, sitemaps |
| Ads | Yes | Yes | Guests only, collapsible, no download gate |
| Discovery | No | Trending/search | Trending today, countries, newest |
| Self-hosted / own domain | No | No | Yes |

## Recommended sequence

### P0 — finish the creator workflow (complete)

1. **(Done.) Bulk selection in the file list.** The share table has an optional
   "Select" toggle that adds a checkbox column. Selection is shared with the
   sequential download loop (`DownloadAllButton`), so a selected set can be
   downloaded as one streamed ZIP when it fits `share.maxZipSize` and falls
   back to per-file downloads otherwise.
2. **(Done.) Share-level download counters in Valkey.** Downloads are counted
   per share and per file in a Valkey-backed rolling 30-day window
   (`DownloadService`: one small per-share, per-day hash with a TTL, a short
   read cache and a bounded in-process fallback; no SQLite columns). The totals
   ride the public share payload (`ShareDTO.downloads`) and are shown to every
   visitor on the share page — a share total in `ShareStats`, per-file counts
   in the file list.
3. **(Done.) Structured data for file lists.** The share `ItemList` exposes a
   nested `DigitalDocument` per file with `identifier`, `encodingFormat`,
   `contentSize`, `dateCreated` and `dateModified`. The backend SEO payload now
   selects each file's `size` and `createdAt`. Low risk, no storage.
4. **(Done.) "Copy link" per file.** Each file row copies a short
   `/d/:shareId/:fileId` link. The alias forwards to the share page with a
   one-shot `?file=` hint, so the normal password/recipient/view checks run
   before the download and the referrer/hotlink protection is left untouched.

### P1 — parity features that need a design decision

5. **(Done.) Streaming ZIP download (no archive on disk).** `GET
   /api/shares/:id/files/zip` builds the archive on the fly with `archiver`
   (local files and S3 both stream live; no `archive.zip` is written). An
   optional `?files=id,id` selects a subset. Selections larger than
   `share.maxZipSize` (default 512 MB) are rejected with 413 so the client
   falls back to per-file downloads; subset responses are `no-store`, full
   public archives keep the short edge TTL. Range is not offered.
6. **(Done — server-side fetch, SSRF-guarded.) Remote upload from URL.**
   `POST /api/shares/:id/files/from-url` downloads the http(s) URL on the server
   (`remoteFetch.util.ts`: ports 80/443 only, DNS validated and pinned to a
   public address, IP-literal hostnames rejected before connecting, redirects
   re-validated and capped, body/time caps) and feeds the bytes through the
   normal chunk pipeline, so hosts without CORS work and quota/scanning still
   apply. The owner-only, rate-limited endpoint never ships a naive `fetch(url)`.
7. **(Done.) Global public search.** `/search` plus `GET /api/shares/search`
   over every public share. The index is stored in Valkey (versioned JSON,
   rebuilt from SQLite on a miss) with no SQLite table/FTS; results carry the
   same edge headers as `/trending` (60 seconds, `no-store` when empty).
   Protected, recipient-only and private reverse shares are excluded through
   `publicShareWhere()`.
8. **API tokens and a small public API.** Gofile's developer ecosystem is its
   moat. A read-only API (share metadata, file list, download URL) plus
   `POST /shares` with scoped tokens would attract integrations without
   duplicating the UI. This needs one small table (token hash, scopes, expiry)
   and careful rate limiting; it is the largest item on this list.

### P2 — only if the product moves toward creators

9. **Albums/collections.** A folder/album layer on top of shares is what bunkr
   users mean by "content manager". It needs a new relation and changes to
   listing, permissions and deletion; it also makes upstream merges harder.
   Prefer grouping shares by a `collection` label stored in Valkey or a single
   nullable column before introducing a full hierarchy.
10. **Uploader profiles and follows.** Requires moderation, blocking, and a
    public identity model. High cost, high abuse surface; skip until there is a
    clear creator programme.
11. **Region picker / multi-node storage.** Useful only at a scale where one
    S3 bucket or disk is the bottleneck. Cloudflare already handles edge
    delivery; keep the single origin until transfer volume justifies it.
12. **Premium tiers / payouts.** Adds payments, tax and refund obligations.
    The current guest-only ad units are a much cheaper monetization experiment.

## What not to copy

- **Unlimited free storage.** It is an acquisition subsidy, not a feature. The
  existing 5 GB/512 MB caps keep Cloudflare caching, disk and backup costs
  predictable.
- **NSFW-first branding and thin moderation.** That segment brings traffic but
  also payment-processor, CDN and legal risk (CSAM reporting, DMCA, age
  verification). The report modal and VirusTotal/ClamAV pipeline are the right
  foundation; do not optimize the product for that audience.
- **Forced waits, fake "download" buttons or ad-gated downloads.** They are
  the main reason users look for an alternative. Guest-only, non-blocking ad
  units on share/404 pages are the correct compromise.
- **Account walls for uploads.** Anonymous sharing plus reverse shares is a
  genuine differentiator; keep it configurable but default-on where abuse
  controls allow.

## Why users would migrate

1. **Predictable downloads.** One click, no countdown, no fake buttons, no
   account. This is the strongest and cheapest message.
2. **Privacy and control.** Rolling expiry, view limits, password/recipient
   restrictions, anonymous uploads, no third-party analytics dependency.
3. **Better sharing surface.** Comments, galleries, reverse shares, QR codes,
   per-file previews, malware badges and a clean mobile layout in one place.
4. **Discovery that respects the visitor.** Trending/new pages are server
   rendered, cacheable and indexable, unlike most ad-funded hosts.
5. **Trust.** Report handling, admin logs, ClamAV/VirusTotal verdicts, no
   download gate and a documented security posture.
6. **Self-hosted ownership.** Custom domain, branding, retention and quotas —
   something neither reference site can offer.

## Implementation guardrails

- Keep ephemeral counters in Valkey (`metrics.service.ts`,
  `trending.service.ts`, `download.service.ts`); SQLite stays for durable
  share/file/user rows.
- Put every new public listing behind `publicShareWhere()`/`isPublicShare()`
  so protected and removed shares never leak into search, sitemaps or feeds.
- Reuse `getEdgeCacheHeaders()`, `NO_STORE_HEADERS` and the existing cache
  versioning instead of adding per-route header strings.
- Any new upload path must reserve quota through the existing in-flight byte
  accounting and finish through the same complete/scan hooks.
- New fork-only strings go in `en-US.ts` under a `*.custom.*` key so other
  locales fall back to English cleanly.
