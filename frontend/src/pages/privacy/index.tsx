import { GetServerSidePropsContext } from "next";
import LegalDocument from "../../components/legal/LegalDocument";
import { getLegalDocument } from "../../content/legalDocuments";
import { fetchConfig } from "../../utils/config.server.util";
import { setPublicCacheHeaders } from "../../utils/httpCache.util";

// See the imprint page: the privacy text is part of the application, while the
// site name/URL come from the current config on each server render.
export async function getServerSideProps({ res }: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config } = await fetchConfig(apiURL);
  const text = getLegalDocument("privacy", config);
  setPublicCacheHeaders(res, 60, 30);
  return { props: { text } };
}

const PrivacyPolicy = ({ text }: { text: string }) => {
  return (
    <LegalDocument
      titleId="privacy-title"
      titleKey="privacy.title"
      descriptionKey="seo.custom.privacy.description"
      path="/privacy"
      text={text}
    />
  );
};

export default PrivacyPolicy;
