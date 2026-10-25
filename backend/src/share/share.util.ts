import { Prisma, ShareSecurity } from "@prisma/client";

// Every share gets a rolling expiration which is reset on each visit.
export const SHARE_EXPIRATION = "100-days";

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
