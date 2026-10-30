import { GetServerSidePropsContext } from "next";
import LegalDocument from "../../components/legal/LegalDocument";
import { getLegalDocument } from "../../content/legalDocuments";
import { fetchConfig } from "../../utils/config.server.util";
import {
  setNoStoreHeaders,
  setPublicCacheHeaders,
} from "../../utils/httpCache.util";

// The document lives in the application, so a release that adds a new feature
// can update the imprint in the same commit. Config is still read on the
// server so the site name/URL in the text follow admin changes; middleware
// makes the HTML edge-cacheable for a short window.
export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config, fallback } = await fetchConfig(apiURL);
  const text = getLegalDocument("imprint", config);
  // Never pin default site values at the edge after a backend hiccup.
  if (fallback) setNoStoreHeaders(res);
  else setPublicCacheHeaders(res, 60, 30);
  return { props: { text } };
}

const Imprint = ({ text }: { text: string }) => {
  return (
    <LegalDocument
      titleId="imprint-title"
      titleKey="imprint.title"
      descriptionKey="seo.custom.imprint.description"
      path="/imprint"
      text={text}
    />
  );
};

export default Imprint;
