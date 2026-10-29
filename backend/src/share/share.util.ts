import { Prisma, ShareSecurity } from "@prisma/client";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";

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

type ShareVisibility = {
  security?: Pick<
    ShareSecurity,
    "password" | "restrictToRecipients" | "maxViews"
  > | null;
  reverseShare?: { publicAccess: boolean } | null;
};

/**
 * A share can be cached publicly when it has no password, no view limit, is
 * not restricted to named recipients and is not a private reverse share.
 */
export function isPublicShare(share?: ShareVisibility | null): boolean {
  return (
    !!share &&
    !share.security?.password &&
    !share.security?.maxViews &&
    !share.security?.restrictToRecipients &&
    (!share.reverseShare || share.reverseShare.publicAccess)
  );
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
 * Reverse shares and per-user limits take precedence over the site default.
 * Keep this in one place so local and S3 uploads enforce the same limit.
 */
export function resolveShareSizeLimit(
  defaultLimit: number,
  share?: ShareSizeLimitSource | null,
): number {
  if (share?.reverseShare?.maxShareSize)
    return parseInt(String(share.reverseShare.maxShareSize));
  if (share?.creator?.shareSizeLimit)
    return parseInt(String(share.creator.shareSizeLimit));
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
