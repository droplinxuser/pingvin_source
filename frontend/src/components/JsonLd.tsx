import { serializeJsonLd } from "../utils/seo.util";

const JsonLd = ({ data }: { data: unknown }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
  />
);

export default JsonLd;
