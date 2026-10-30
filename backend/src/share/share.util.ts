import { Prisma, ShareSecurity } from "@prisma/client";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";
import { KeyedLock } from "src/utils/keyedLock.util";

/**
 * Serializes upload completion with chunk writes for the same share. Without
 * this, a chunk that already passed its `uploadLocked` check can append and
 * insert a File row after completion took its size/scan snapshot.
 */
export const shareWriteLock = new KeyedLock();

// Every share gets a rolling expiration which is reset on each visit. Member
// shares (an authenticated creator) keep the long window; anonymous/guest
// uploads expire much sooner.
export const SHARE_EXPIRATION = "100-days";
export const GUEST_SHARE_EXPIRATION = "10-days";

type ShareCreatorSource = {
  creatorId?: string | null;
  creator?: unknown | null;
};

/**
 * A share belongs to a member when an authenticated user created it. Guest
 * uploads (including anonymous reverse-share uploads) have no creator row.
 */
export function isMemberShare(share?: ShareCreatorSource | null): boolean {
  return !!share && !!(share.creatorId ?? share.creator);
}

/** Rolling expiration window for a member or guest share. */
export function getShareExpiration(isMember: boolean): Date {
  return parseRelativeDateToAbsolute(
    isMember ? SHARE_EXPIRATION : GUEST_SHARE_EXPIRATION,
  );
}

/**
 * A share with the epoch (0) as its expiration never expires. Every guard,
 * listing and cache path must use this same rule; a raw date comparison would
 * otherwise treat "never" as "expired long ago".
 */
export function isShareExpired(
  expiration: Date | string,
  now = Date.now(),
): boolean {
  const time =
    expiration instanceof Date
      ? expiration.getTime()
      : new Date(expiration).getTime();
  return time !== 0 && Number.isFinite(time) && time <= now;
}

type ShareVisibility = {
  security?: Pick<
    ShareSecurity,
    "password" | "restrictToRecipients" | "maxViews" | "maxDownloads"
  > | null;
  reverseShare?: { publicAccess: boolean } | null;
};

/**
 * A share can be opened without a password, view limit, recipient restriction
 * or private reverse share. A download cap does not require a credential, so
 * it is not part of this access check.
 */
export function isAccessPublicShare(share?: ShareVisibility | null): boolean {
  return (
    !!share &&
    !share.security?.password &&
    !share.security?.maxViews &&
    !share.security?.restrictToRecipients &&
    (!share.reverseShare || share.reverseShare.publicAccess)
  );
}

/**
 * A share can be cached publicly and listed/indexed when it has no access
 * restriction and no download cap. Download-capped shares must reach the
 * origin to enforce the cap, so they are never treated as cacheable/public
 * listing entries even when they do not need a password.
 */
export function isPublicShare(share?: ShareVisibility | null): boolean {
  return isAccessPublicShare(share) && !share?.security?.maxDownloads;
}

/**
 * SQL predicate shared by the listings that expose public shares (recent,
 * sitemap). Keeping it next to `isPublicShare` stops the SQL and in-memory
 * visibility rules from drifting apart.
 */
export function publicShareWhere(now = new Date()): Prisma.ShareWhereInput {
  return {
    uploadLocked: true,
    removedReason: null,
    files: { some: {} },
    AND: [
      {
        OR: [
          { expiration: { gt: now } },
          { expiration: { equals: new Date(0) } },
        ],
      },
      {
        OR: [
          { security: null },
          {
            security: {
              is: {
                password: null,
                maxViews: null,
                maxDownloads: null,
                restrictToRecipients: false,
              },
            },
          },
        ],
      },
      {
        OR: [
          { reverseShare: null },
          { reverseShare: { is: { publicAccess: true } } },
        ],
      },
    ],
  };
}

/**
 * Unremoved, uploaded and unexpired shares owned by a user. Used by the share
 * limit checks and the account listing.
 */
export function activeShareWhere(
  creatorId: string,
  now = new Date(),
): Prisma.ShareWhereInput {
  return {
    creatorId,
    uploadLocked: true,
    removedReason: null,
    OR: [{ expiration: { gt: now } }, { expiration: { equals: new Date(0) } }],
  };
}

/**
 * Share size is derived from the files instead of being stored on the share,
 * so the API and every list endpoint calculate it the same way.
 */
export function sumFileSizes(
  files?: { size: string | number }[] | null,
): number {
  return (
    files?.reduce(
      (total, file) => total + (parseInt(String(file.size)) || 0),
      0,
    ) ?? 0
  );
}

type ShareSizeLimitSource = {
  reverseShare?: { maxShareSize?: string | number | null } | null;
  creator?: { shareSizeLimit?: string | number | null } | null;
};

/**
 * Parses a stored size limit into a positive safe integer. A blank, non-numeric
 * or absurdly large value falls back to the site default instead of disabling
 * every upload cap (`parseInt` returns Infinity for a long digit string).
 */
export function parseSizeLimit(
  value: string | number | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reverse shares and per-user limits take precedence over the site default.
 * Keep this in one place so local and S3 uploads enforce the same limit.
 */
export function resolveShareSizeLimit(
  defaultLimit: number,
  share?: ShareSizeLimitSource | null,
): number {
  if (share?.reverseShare?.maxShareSize)
    return parseSizeLimit(share.reverseShare.maxShareSize, defaultLimit);
  if (share?.creator?.shareSizeLimit)
    return parseSizeLimit(share.creator.shareSizeLimit, defaultLimit);
  return defaultLimit;
}

/**
 * Checks a share's view limit. File access is allowed on the last permitted
 * view, while new share tokens are blocked once that limit is reached.
 */
export function isViewLimitExceeded(
  views: number,
  maxViews?: number | null,
  allowAtLimit = false,
): boolean {
  if (!maxViews) return false;
  return allowAtLimit ? views > maxViews : views >= maxViews;
}
