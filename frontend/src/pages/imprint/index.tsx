import LegalDocument from "../../components/legal/LegalDocument";
import { fetchConfig } from "../../utils/config.server.util";
import { getConfigValue } from "../../utils/seo.util";

// The shared app config only carries a presence marker for legal documents, so
// this page reads its own document on the server. Keeping the text in a page
// prop also makes client navigation independent of the config loaded with the
// first page.
export async function getServerSideProps() {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  const { config } = await fetchConfig(apiURL);
  return {
    props: {
      text: getConfigValue(config, "legal.imprintText"),
    },
  };
}

const Imprint = ({ text }: { text?: string }) => {
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
