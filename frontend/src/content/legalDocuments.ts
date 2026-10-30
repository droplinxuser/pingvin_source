import type Config from "../types/config.type";
import {
  getConfiguredSiteUrl,
  getPublicBaseUrl,
  getSiteName,
} from "../utils/seo.util";

export type LegalDocumentKind = "imprint" | "privacy";

type LegalContext = {
  siteName: string;
  siteUrl: string;
  contactUrl: string;
};

const documentContext = (config: Config[]): LegalContext => {
  const siteName = getSiteName(config);
  const siteUrl = getPublicBaseUrl(getConfiguredSiteUrl(config));
  return {
    siteName,
    siteUrl,
    contactUrl: siteUrl ? `${siteUrl}/contact` : "/contact",
  };
};

const footer = ({ siteName, contactUrl }: LegalContext) => `
## Contact

Questions about this document or the service can be sent through the
[contact page](${contactUrl}). Please include enough detail for us to identify
the affected share or account. Reports about illegal or harmful content are
handled through the same channel.

This document is maintained together with the ${siteName} application. It is
updated when the service adds or changes a feature that affects the data we
process or the way the service is operated.
`;

/**
 * Built-in legal documents. Keeping them in the application (instead of an
 * admin-only text field) means a new feature can ship with an updated notice in
 * the same release, and every deployment gets the same current text. The
 * documents use the configured site name and URL, so branding/config changes
 * are picked up on the next server render (the HTML itself is still edge
 * cacheable for a short window).
 */
export const getLegalDocument = (
  kind: LegalDocumentKind,
  config: Config[],
): string => {
  const context = documentContext(config);
  const { siteName, siteUrl } = context;
  const url = siteUrl || "this website";

  if (kind === "imprint") {
    return `# Imprint

## Service provider

${siteName} is a self-hosted file-sharing service operated at ${url}.

**Contact:** [contact page](${context.contactUrl})

## Responsibility for content

Shares, comments and other content are uploaded by users of the service. The
operator does not review every upload in advance. Uploaded content is stored
only for the period configured for the service and can be removed by the owner,
an administrator, or an automated malware scan.

## Responsibility for links

The service may contain links to third-party websites. The operator has no
control over their content and is not responsible for it. The respective
provider is responsible for the content of linked pages.

## Copyright and trademark rights

Upload only material that you own or are allowed to distribute. If you believe
that content on this service infringes your rights, use the report action on
the affected share or the [contact page](${context.contactUrl}) and include the
share link, the affected file and a description of your rights.

## Abuse and illegal content

The service must not be used to distribute malware, child sexual abuse
material, non-consensual intimate imagery, stolen personal data or other
illegal content. Reports are reviewed and content may be removed without prior
notice. Where required by law, reports may be forwarded to the competent
authorities.

## Availability and changes

The service is provided on a best-effort basis. Features, limits and retention
periods may change to keep the service secure and sustainable.
${footer(context)}`;
  }

  return `# Privacy Policy

This policy explains what ${siteName} processes when you visit the site, upload
or download files, create an account, or contact the operator.

## Controller

The service is operated by the operator of ${url}. Contact requests can be sent
through the [contact page](${context.contactUrl}).

## Data we process

### Account data

If you create an account, we store your username, email address, a password
hash (never the password itself), optional profile details and, if enabled, an
avatar. If you sign in through an external identity provider, we receive the
identifier and profile information that provider releases to us. Account data
is used to authenticate you and to provide your shares and settings.

### Uploads and share metadata

When you upload files, we store the file content, file name, size, timestamps,
share settings (such as a name, description, password hash, view limit or
recipient list) and download/visit counters. Uploaded content is visible to
anyone who has the share link unless you enable a password, recipient
restriction or another access control. Do not upload content that you are not
allowed to share.

### Technical and usage data

When a share is opened, we may record aggregate information such as the view
count, the country or region supplied by the CDN, the browser and operating
system family, the referring domain and timestamps. The visitor list is shown
on the share page and is used to operate the service. We do not store the full
IP address in the share metadata.

Rate limiting uses a short-lived, hashed identifier derived from your IP address
and browser user agent. The hash is stored only for the rate-limit window and
is not used to identify you across services. Server and error logs are kept for
a limited diagnostic period.

### Cookies and local storage

The service uses strictly necessary cookies and local storage for sign-in
tokens, language and theme preferences, share access tokens and reverse-share
upload permission. These values keep you signed in and enforce share access
rules. Clearing them signs you out or requires you to enter a share password
again.

Guests may see advertising units. Ad providers can set their own cookies or
similar identifiers when an ad is displayed; signed-in visitors, protected
shares and reverse-share upload pages do not load those units. Where required,
consent is requested by the ad provider or the applicable consent mechanism.

## Why we process data

We process data to provide the file-sharing service, authenticate users,
enforce storage and access limits, prevent abuse, diagnose errors, secure the
service, comply with legal obligations and respond to reports. Where the GDPR
or comparable law applies, the legal bases are performance of a contract,
legitimate interests in operating a secure service, consent where requested,
and legal obligations.

## Recipients and service providers

Data may be processed by infrastructure providers that host the application,
database and files, by the CDN and security provider that delivers the site and
protects it from abuse, by the configured email provider that sends
notifications and contact replies, and by malware-scanning providers that
receive file hashes or samples as described below. These providers process data
on our behalf or under their own terms.

Virus scanning may send a file hash, and in some cases a file sample, to a
malware-analysis provider. Files identified as malicious are removed. Antivirus
software may also inspect uploaded files locally on the server.

## Retention

Shares expire automatically. Member shares use the configured rolling member
window and guest shares use the shorter guest window; opening a share extends
its window. Expired shares and their files are deleted by the cleanup job.
Account data remains until the account is deleted or the operator removes it.
Aggregate counters and operational logs have short retention windows. Backups
may retain deleted data for a limited period before they are rotated.

## Your rights

Depending on your jurisdiction, you may request access to, correction of, or
deletion of your personal data, object to or restrict certain processing, or
request data portability. You may also lodge a complaint with your local data
protection authority. Use the [contact page](${context.contactUrl}) and include
the account or share involved so we can locate the data.

## Security

Passwords are stored as Argon2 hashes. Access to protected shares requires a
password or share token. Administrative endpoints require an authenticated
administrator account. Files are served over HTTPS when the site is configured
with HTTPS. No service can guarantee absolute security; report suspected
vulnerabilities or unauthorized access promptly.

## Children

The service is not directed at children below the age required to consent to
data processing in their jurisdiction. Do not create an account or upload
personal data if you are below that age.

## Changes

We may update this policy when the service changes. The current version is
always available on this page. Material changes will be reflected here and,
where appropriate, communicated through the service.
${footer(context)}`;
};
