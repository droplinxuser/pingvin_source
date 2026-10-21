import { ShareSecurity } from "@prisma/client";

type ShareVisibility = {
  security?: Pick<ShareSecurity, "password" | "restrictToRecipients"> | null;
  reverseShare?: { publicAccess: boolean } | null;
};

/**
 * A share is publicly accessible when it has no password, is not restricted to
 * named recipients and is not a private reverse share.
 */
export function isPublicShare(share?: ShareVisibility | null): boolean {
  return (
    !!share &&
    !share.security?.password &&
    !share.security?.restrictToRecipients &&
    (!share.reverseShare || share.reverseShare.publicAccess)
  );
}
