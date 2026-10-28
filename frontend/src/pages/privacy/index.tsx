import LegalDocument from "../../components/legal/LegalDocument";
import { fetchConfig } from "../../utils/config.server.util";
import { getConfigValue } from "../../utils/seo.util";

// See the imprint page: the shared config omits the full legal markdown, so
// each legal page loads only its own document.
export async function getServerSideProps() {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config } = await fetchConfig(apiURL);
  return {
    props: {
      text: getConfigValue(config, "legal.privacyPolicyText"),
    },
  };
}

const PrivacyPolicy = ({ text }: { text?: string }) => {
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
