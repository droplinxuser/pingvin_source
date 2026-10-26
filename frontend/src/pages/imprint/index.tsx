import LegalDocument from "../../components/legal/LegalDocument";
import useConfig from "../../hooks/config.hook";

const Imprint = () => {
  const config = useConfig();

  return (
    <LegalDocument
      titleId="imprint-title"
      titleKey="imprint.title"
      descriptionKey="seo.custom.imprint.description"
      path="/imprint"
      text={config.get("legal.imprintText")}
    />
  );
};

export default Imprint;
