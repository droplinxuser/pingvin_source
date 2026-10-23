import { ShareSecurity } from "@prisma/client";

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
