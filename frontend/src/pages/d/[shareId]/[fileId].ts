import { GetServerSidePropsContext } from "next";
import { getQueryString } from "../../../utils/router.util";
import { setNoStoreHeaders } from "../../../utils/httpCache.util";

// Share and file ids are base64url-ish. Validate before building the redirect
// so a malformed link becomes a normal 404 instead of an odd share URL.
const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Short per-file link alias. It forwards to the share page with a one-shot
 * `?file=` hint; the share page runs the normal password/recipient/view checks
 * and then downloads the file. This keeps every protection intact while making
 * a pasted "Copy link" URL usable, unlike a raw API URL that the referrer
 * check would bounce back to the share page.
 */
export function getServerSideProps(context: GetServerSidePropsContext) {
  const shareId = String(context.params?.shareId ?? "");
  const fileId = String(context.params?.fileId ?? "");
  const recipientId = getQueryString(context.query.recipient);

  setNoStoreHeaders(context.res);
  context.res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (!VALID_ID.test(shareId) || !VALID_ID.test(fileId)) {
    return { notFound: true } as const;
  }

  const params = new URLSearchParams({ file: fileId });
  if (recipientId) params.set("recipient", recipientId);

  return {
    props: {},
    redirect: {
      // Temporary so a copied link keeps working if the share is later
      // locked down or the file is removed.
      permanent: false,
      destination: `/share/${shareId}?${params.toString()}`,
    },
  };
}

export default function FileLinkAlias() {
  return null;
}
