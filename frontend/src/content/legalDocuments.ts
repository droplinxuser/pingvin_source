import type Config from "../types/config.type";
import { byteToHumanSizeString } from "../utils/fileSize.util";
import {
  getConfigValue,
  getConfiguredSiteUrl,
  getPublicBaseUrl,
  getSiteName,
} from "../utils/seo.util";

export type LegalDocumentKind = "imprint" | "privacy";

const LEGAL_LAST_UPDATED = "October 31, 2026";

type LegalContext = {
  siteName: string;
  siteUrl: string;
  contactUrl: string;
  privacyUrl: string;
  imprintUrl: string;
  searchUrl: string;
  trendingUrl: string;
  newMediaUrl: string;
  newFilesUrl: string;
  maxShareSize: string;
  maxFileSize: string;
  maxZipSize: string;
  guestUploads: boolean;
};

const pageUrl = (siteUrl: string, path: string) =>
  siteUrl ? `${siteUrl}${path}` : path;

const configSize = (config: Config[], key: string, fallback: string) => {
  const bytes = Number(getConfigValue(config, key));
  return Number.isFinite(bytes) && bytes > 0
    ? byteToHumanSizeString(bytes)
    : fallback;
};

const documentContext = (config: Config[]): LegalContext => {
  const siteName = getSiteName(config);
  const siteUrl = getPublicBaseUrl(getConfiguredSiteUrl(config));

  return {
    siteName,
    siteUrl,
    contactUrl: pageUrl(siteUrl, "/contact"),
    privacyUrl: pageUrl(siteUrl, "/privacy"),
    imprintUrl: pageUrl(siteUrl, "/imprint"),
    searchUrl: pageUrl(siteUrl, "/search"),
    trendingUrl: pageUrl(siteUrl, "/trending"),
    newMediaUrl: pageUrl(siteUrl, "/new-media"),
    newFilesUrl: pageUrl(siteUrl, "/new-files"),
    maxShareSize: configSize(config, "share.maxSize", "the current limit"),
    maxFileSize: configSize(config, "share.maxFileSize", "the current limit"),
    maxZipSize: configSize(config, "share.maxZipSize", "the current limit"),
    guestUploads:
      getConfigValue(config, "security.allowUnauthenticatedShares") === "true",
  };
};

const footer = ({ siteName, contactUrl }: LegalContext) => `
## Contact

Questions about this document, the service, a share or an account can be sent
through the [contact page](${contactUrl}). Include the affected link or account
where possible so the request can be handled quickly.

Reports about illegal or harmful content, copyright complaints and privacy
requests are handled through the same channel.

This document is maintained together with the ${siteName} service and is
updated when the service or the data it processes changes.
`;

/**
 * Built-in legal documents. Keeping them in the application (instead of an
 * admin-only text field) means a new feature can ship with an updated notice in
 * the same release, and every deployment gets the same current text. The
 * documents use the configured site name/URL and current upload limits, so
 * branding and limit changes are picked up on the next server render.
 */
export const getLegalDocument = (
  kind: LegalDocumentKind,
  config: Config[],
): string => {
  const context = documentContext(config);
  const { siteName, siteUrl } = context;
  const url = siteUrl || "this website";

  if (kind === "imprint") {
    const uploadAccess = context.guestUploads
      ? `You can upload and share without an account. Guest shares keep a
**10-day** rolling window; account holders keep a **100-day** rolling window.
Each visit extends the window.`
      : `An account is required to upload on this deployment. Account shares
keep a **100-day** rolling window, extended by each visit.`;

    return `**Last updated:** ${LEGAL_LAST_UPDATED}

${siteName} is a free file-sharing service at ${url}. It lets people upload
files and folders, create a share link, and send that link to anyone. Shares can
be protected, limited, or left public for discovery.

## Service provider

The service is operated by the operator of ${siteName}. The current contact
channel for legal, privacy, copyright and abuse matters is the
[contact page](${context.contactUrl}).

## What the service provides

### Upload and share

- Upload files and folders with drag-and-drop, a file picker, clipboard paste,
  or a supported file link.
- Give a share a custom name, description and short link, and create a QR code
  for it.
- Send a share by email to one or more recipients where email delivery is
  enabled.
- Current limits are **${context.maxShareSize} per share** and
  **${context.maxFileSize} per file**. The upload page always shows the active
  limits.

${uploadAccess}

### Preview, download and organize

- Preview common image, video, audio, PDF and text formats in the browser.
- Browse image and video galleries, move between previews with the keyboard,
  and search inside large file lists.
- Download files individually, or download a selected set as one ZIP archive
  when it fits the current **${context.maxZipSize}** ZIP limit.

### Control access

- Protect a share with a password, a view limit, or recipient-only access where
  those options are enabled.
- Use automatic expiration instead of managing dates manually.
- Create a file-request link (reverse share) so other people can send files to
  you without creating their own share.

### Discover public content

- Browse [Trending](${context.trendingUrl}), [New media](${context.newMediaUrl}),
  [New files](${context.newFilesUrl}) and [Search](${context.searchUrl}).
- Public shares may appear in search engines, sitemaps, social previews and
  public listings. Password-protected, recipient-only and private shares are
  excluded from public discovery.

### Accounts and community

- Create an account with the sign-in methods currently offered, manage your
  profile and avatar, use optional two-factor authentication where available,
  and review your shares and file requests from your account.
- Signed-in visitors can comment on shares. Comments are plain text; links and
  HTML markup are removed, and owners or moderators can remove comments.
- Use the report action on a share or the contact page to report abuse.
- Automated security checks may inspect uploads and remove content identified
  as malicious.

### Accessibility and preferences

- Responsive layouts for phones, tablets and desktop computers.
- Light, dark and system themes, multiple languages, keyboard-accessible
  controls, and an installable web-app experience where the browser supports it.
- Guest visitors may see third-party ads on share and missing-share pages,
  including some protected or view-limited shares. Ads are not shown to
  signed-in visitors or while a file-request upload session is active.

## Responsibility for content

Shares, comments and other content are uploaded by users. The operator does not
review every upload in advance. Content may be removed when it violates these
terms, the law, or the rights of others. Upload only material you own or are
allowed to distribute.

## Copyright and trademark rights

If you believe content on this service infringes your copyright or trademark,
use the report action on the affected share or the
[contact page](${context.contactUrl}). Include the share link, the affected file
and enough detail to identify your rights. Valid notices are reviewed and
content may be removed without prior notice.

## Abuse and illegal content

The service must not be used to distribute malware, child sexual abuse material,
non-consensual intimate imagery, stolen personal data, spam, or other illegal
content. Do not use the service to harass people or evade access controls.
Reports are reviewed, content may be removed, and accounts or links may be
restricted. Where required by law, reports may be forwarded to the competent
authorities.

## Links to other sites

The service may contain links to third-party websites. The operator does not
control those sites and is not responsible for their content or privacy
practices. The respective provider is responsible for its own pages.

## Availability and liability

The service is provided on an “as is” and “as available” basis. It is not a
backup or long-term storage service. Files may expire, be removed, or become
unavailable, and features or limits may change to keep the service secure and
sustainable. Keep your own copy of anything important. To the extent permitted
by law, the operator is not liable for lost files, expired links, or damages
resulting from use of the service.

## Privacy

The [Privacy Policy](${context.privacyUrl}) explains what data is processed,
why, how long it is kept, and the choices available to you. It forms part of the
terms for using the service.

## Changes

This page may be updated when the service, its features or its legal
requirements change. The current version is always published here.

${footer(context)}`;
  }

  return `**Effective date:** ${LEGAL_LAST_UPDATED}
**Last updated:** ${LEGAL_LAST_UPDATED}

This Privacy Policy explains what ${siteName} processes when you visit the
site, upload or download files, create an account, comment, use a file-request
link, or contact the operator. It applies to ${url} and does not cover
third-party websites.

## Summary

- We process account data, the files and shares you create, comments, and the
  technical data needed to operate and secure the service.
- Share pages display uploader and recent-visitor information, including
  approximate location, browser and operating system, referrer domain, and
  timestamps. Anyone with the link can see it.
- Public shares may be indexed by search engines and may appear in public
  listings and social previews. Protected, recipient-only and private shares are
  excluded from public discovery.
- Guest visitors may see third-party ads on some public and missing-share pages.
  Signed-in visitors do not see those ads.
- We do not sell personal information.

## Who is responsible?

The service is operated by the operator of ${siteName}. Privacy requests and
questions can be sent through the [contact page](${context.contactUrl}).

## Information we process

### Account information

If you create an account, we process your username, email address, a protected
password value (never the plain password), optional display name and profile
picture, account preferences, account status, quotas and security settings. If
you sign in through an external identity provider, we receive the identifier
and profile information that provider releases to us.

### Files, shares and comments

When you upload or share content, we process the file content, file names,
sizes, types, timestamps, share names and descriptions, custom links, access
settings (such as a protected password value, view limit or recipient list),
download and visit counters, and comments you post. Comments include your
username, display name, profile-picture version, comment text and timestamp.

Uploaded content is visible to anyone who has the share link unless you enable a
password, recipient restriction or another access control. Do not upload content
you are not allowed to share.

### Uploader and visitor information

Share pages show technical information derived from the upload and from visits:

- approximate location, such as country, region and city;
- timezone;
- browser name and version;
- operating system and device type;
- the domain of the external site that referred a visitor;
- upload and visit timestamps.

A short list of up to 18 recent visitors is kept with the share. This
information is visible to everyone who can open the share. IP addresses are not
displayed publicly.

### Technical, security and diagnostic data

We process technical data needed to deliver and protect the service, including
request information, a short-lived identifier used for rate limiting and abuse
prevention, authentication events, error messages and diagnostics. Error reports
may include the page path, browser information, an error message and a stack
trace; query strings are not included in client error reports.

### Communications

If you contact us, submit a report, send a share by email, or use a file-request
link, we process the content of the message and the email addresses involved.
Where download notifications are enabled, a share owner may receive an email
when a recipient downloads a file.

### Cookies and local storage

We use cookies and browser storage for essential functionality, security and
preferences. The main values are:

| Name | Purpose | Lifetime |
|---|---|---|
| \`access_token\` | Keeps you signed in and authorizes requests | Up to 3 months |
| \`refresh_token\` | Renews your session; HTTP-only and limited to the token endpoint | Up to the configured session lifetime (currently 1 year) |
| \`share_<id>_token\` | Remembers that you unlocked a share | Browser session |
| \`reverse_share_token\` | Grants access to a file-request upload | Browser session |
| \`language\` | Remembers your language choice | Up to 1 year |
| \`mantine-color-scheme\` | Remembers your light, dark or system theme | Browser session |
| \`reverse-share.simplified\` | Remembers file-request form preferences | Browser session |
| \`reverse-share.public-access\` | Remembers file-request visibility preferences | Browser session |

Browser local storage may also keep interface preferences and a marker that a
share was unlocked in this browser. These values stay on your device and can be
cleared through your browser settings. Clearing cookies may sign you out or
require you to enter a share password again.

Guests may see third-party advertising on share and missing-share pages,
including some protected or view-limited shares. Advertising partners may set
their own cookies or similar identifiers when an ad is displayed. Signed-in
visitors and active file-request upload sessions do not load those ads. Where
required, consent is requested by the ad provider or the applicable consent
mechanism.

## Why we process information

We process information to:

- provide, operate and secure the service;
- upload, store, preview and deliver files;
- create and manage shares, file requests, comments and recipient access;
- enforce passwords, view limits, recipient restrictions and expiration;
- send emails you request, including share links, notifications and security
  messages;
- display uploader information, view counts and recent visitors;
- produce aggregate statistics such as trending shares and country rankings;
- detect and prevent abuse, fraud, malware and security incidents;
- respond to reports, support requests and legal requests;
- maintain, troubleshoot and improve the service;
- comply with legal obligations.

## Legal bases

Where data protection law requires a legal basis, we rely on:

- **Contract:** to provide the file-sharing service you request.
- **Legitimate interests:** to secure the service, prevent abuse, moderate
  content and improve functionality.
- **Consent:** where we rely on consent for a specific feature,
  communication or third-party technology.
- **Legal obligation:** to comply with applicable law and valid legal requests.

## Sharing and service providers

We do not sell personal information. We may share information with:

- **Identity providers** you choose when signing in through an external account.
- **Hosting, storage, delivery, security and email providers** that operate or
  support the service.
- **Automated security and malware-analysis providers** that help identify
  malicious files.
- **Advertising partners** that serve ads to guests on public pages.
- **Legal authorities** when required by law or necessary to protect rights,
  safety and security.
- **Professional advisers and successors** in connection with a
  reorganization, transfer or sale of the service.

These providers process information under their own terms or on our behalf,
depending on the service. They may process data in countries other than your
own; where required, appropriate safeguards are used.

## Malware and security checks

Uploaded files may be checked by automated security tools. A file fingerprint
may be compared with security intelligence sources, and in some cases a file
sample may be submitted to an external malware-analysis provider. Files
identified as malicious may be removed, and the uploader or file-request owner
may be notified. Security results may be shown as a badge on the share page. Scanning
reduces risk but does not guarantee that a file is safe.

## Retention

- **Share files and metadata** remain available until the share expires or is
  deleted. Guest shares expire after **10 days without a visit**; account shares
  after **100 days without a visit**. Each visit extends the window.
- **Expired shares and their files** are removed by the automatic cleanup. A
  short delay is possible while cleanup runs.
- **Incomplete uploads** are removed after about one day.
- **Comments** remain with the share until the comment, share or account is
  deleted.
- **Account information** remains while the account is active. Deleting the
  account removes the account, its shares, files uploaded through its
  file-request links, and its profile picture, subject to backups and legal
  retention requirements.
- **Reports and support messages** are kept as needed for moderation, security
  and legal compliance.
- **Diagnostics and aggregate metrics:** error logs are kept for about 7 days;
  page-view totals for about 24 hours; download counters for about 30 days; the
  referrer-domain ranking for about 90 days. Operational and security logs are
  kept for a limited period and may contain IP addresses.
- **Backups** may retain deleted data for a limited period before they are
  rotated.

## Security

We use encrypted connections, access controls, rate limiting, optional
two-factor authentication, protected password storage and automated malware
checks. Protected shares require a password or access token. Authorized
administrators may access shares and account data for operation, security,
moderation and legal compliance.

Files are not end-to-end encrypted. No method of transmission or storage is
completely secure, and absolute security cannot be guaranteed. Keep your
credentials and share links private, and report suspected vulnerabilities or
unauthorized access promptly.

## Your rights and choices

Depending on your jurisdiction, you may have the right to access, correct or
delete personal information, object to or restrict certain processing, request
data portability, or withdraw consent where processing is based on consent. You
may also lodge a complaint with your local data protection authority.

You can update your username, display name, profile picture, language and theme
in your account settings. For other requests, use the
[contact page](${context.contactUrl}) and include the account or share involved
so the data can be located. Identity verification may be required before a
request is completed.

## Children

The service is not directed at children below the age required to consent to
online services or data processing in their jurisdiction. Do not create an
account or upload personal information if you are below that age. If you believe
a child has provided personal information, contact us and it will be removed.

## International transfers

The service and its providers may process information in countries other than
your own. Where required, appropriate safeguards are used for those transfers.

## Changes to this policy

This policy may be updated when the service, its features or legal requirements
change. The revised version is published on this page with a new effective date.
Continued use of the service after an update means you accept the revised
policy.

${footer(context)}`;
};
