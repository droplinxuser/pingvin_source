import LegalDocument from "../../components/legal/LegalDocument";
import useConfig from "../../hooks/config.hook";

const PrivacyPolicy = () => {
  const config = useConfig();

  return (
    <LegalDocument
      titleId="privacy-title"
      titleKey="privacy.title"
      descriptionKey="seo.custom.privacy.description"
      path="/privacy"
      text={config.get("legal.privacyPolicyText")}
    />
  );
};

export default PrivacyPolicy;
