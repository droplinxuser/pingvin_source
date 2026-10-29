# Feature roadmap: what to borrow from gofile.io and bunkr.cr

This note compares the fork's current feature set with the two reference
sites and ranks the gaps that are worth closing. It is intentionally written
from the perspective of an operator who values low maintenance, upstream
alignment, privacy and search traffic — not of a site that copies every
growth hack of an ad-funded host.

The short version: DropMB already wins on the things that make people leave
gofile and bunkr (no forced wait, no fake download page, no account required,
expiring links, comments, reverse shares, password/view limits, malware
scanning, galleries and SEO). The remaining gaps are mostly **creator
workflow** (search, bulk actions, analytics, API) rather than core sharing.

## Current comparison

| Capability | gofile.io | bunkr.cr | DropMB today |
|---|---|---|---|
| Share without an account | Yes | No (uploader account) | Yes (configurable) |
| Storage limit | Advertised unlimited | Album quotas / paid tiers | 5 GB per share, 512 MB per file |
| Link lifetime | Inactivity based | Long-lived albums | Rolling 100 days, auto-extended on view |
| Direct file links | Yes | Yes | Behind share-page hotlink check |
| Password / visitor limit | Password | Password | Password, view limit, recipient-only |
| Receive files from others | Limited | No | Reverse shares (stronger) |
| Gallery / inline streaming | Basic preview | Core experience | Image/video gallery, PDF/text/audio preview |
| Comments | No | Limited | Yes, plain-text, moderated by owner/admin |
| Search inside a share | No | Yes (album search) | Yes, from this session (client-side) |
| Search across public content | No | Yes | No |
| Bulk download | Folder download | Album download | Download all (browser sequence) |
| Upload from URL | Yes | Yes | No |
| Public API | Yes (token) | Community/unofficial | No |
| Per-file analytics | Basic | Views/downloads | Share views only |
| Malware scanning | No | No | ClamAV + VirusTotal, background queue |
| Abuse reporting | Minimal | Minimal | Report modal + email routing |
| SEO / social cards | Weak | Weak | Canonicals, OG/Twitter, JSON-LD, sitemaps |
| Ads | Yes | Yes | Guests only, collapsible, no download gate |
| Discovery | No | Trending/search | Trending today, countries, newest |
| Self-hosted / own domain | No | No | Yes |

## Recommended sequence

### P0 — finish the creator workflow (small, high leverage)

1. **Bulk selection in the file list.** Add an optional checkbox column and
   reuse `DownloadAllButton`'s sequential download loop for the selected set.
   This is the single most requested gofile/bunkr interaction for multi-file
   shares and needs no schema change. Keep it behind a "Select" toggle so the
   default table stays uncluttered.
2. **Share-level download counters in Valkey.** Record `downloads` per share
   and per file in the existing `MetricsService`/`TrendingService` pattern
   (hourly buckets, 30-day TTL), then show totals on the owner's share page.
   Do **not** add SQLite columns; Valkey already owns ephemeral counters and
   the fork's rule is "Valkey first".
3. **Structured data for file lists.** `ItemList` is already emitted for
   shares; add `dateModified` and `contentSize` per `DigitalDocument` entry so
   media/file results can earn richer snippets. Low risk, no storage.
4. **"Copy link" per file.** Before shipping, decide the hotlink policy: a
   pasted direct URL currently redirects to the share page because the referrer
   check fails. Either allow no-referrer direct GETs for public shares or make
   the copied URL a short `/d/:shareId/:fileId` route that issues the same
   share-token cookie flow. The second option preserves protection and is the
   better long-term shape.

### P1 — parity features that need a design decision

5. **Streaming ZIP download (no archive on disk).** Upstream's archive builder
   was removed for storage reasons, but a streamed ZIP (archiver piped to the
   response, with Range disabled) gives users the album download they expect
   without keeping `archive.zip` around. Reuse the existing per-file guards and
   size checks; cap the streamed selection to a sane size (for example 2 GB) and
   keep per-file downloads for larger sets.
6. **Remote upload from URL.** Gofile's most useful migration tool. Treat it
   as a server-side fetch: allow only http/https, block private/link-local IPs
   after DNS resolution, cap redirects, bytes and time, and run it through the
   same upload/quota/VirusTotal pipeline. This is a security-sensitive feature;
   do not ship a naive `fetch(url)`.
7. **Global public search.** Add `/search` for public, indexable, non-protected
   shares. SQLite `LIKE` over `Share.name`/`description` with a `LIMIT` is
   enough at the current size and avoids an FTS table; cache the result in
   Valkey for a minute and set the same edge headers as `/trending`. Exclude
   protected and recipient-only shares in `publicShareWhere()`.
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
    The current ad slot is a much cheaper monetization experiment.

## What not to copy

- **Unlimited free storage.** It is an acquisition subsidy, not a feature. The
  existing 5 GB/512 MB caps keep Cloudflare caching, disk and backup costs
  predictable.
- **NSFW-first branding and thin moderation.** That segment brings traffic but
  also payment-processor, CDN and legal risk (CSAM reporting, DMCA, age
  verification). The report modal and VirusTotal/ClamAV pipeline are the right
  foundation; do not optimize the product for that audience.
- **Forced waits, fake "download" buttons, pop-unders or ad-gated downloads.**
  They are the main reason users look for an alternative. The guest-only,
  collapsible ad slot is the correct compromise.
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
  `trending.service.ts`); SQLite stays for durable share/file/user rows.
- Put every new public listing behind `publicShareWhere()`/`isPublicShare()`
  so protected and removed shares never leak into search, sitemaps or feeds.
- Reuse `getEdgeCacheHeaders()`, `NO_STORE_HEADERS` and the existing cache
  versioning instead of adding per-route header strings.
- Any new upload path must reserve quota through the existing in-flight byte
  accounting and finish through the same complete/scan hooks.
- New fork-only strings go in `en-US.ts` under a `*.custom.*` key so other
  locales fall back to English cleanly.
