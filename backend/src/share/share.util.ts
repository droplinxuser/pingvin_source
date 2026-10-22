import { ShareSecurity } from "@prisma/client";

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
