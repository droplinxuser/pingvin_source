import useConfig from "./config.hook";
import { DEFAULT_SITE_NAME, getPublicBaseUrl } from "../utils/seo.util";

/**
 * The visible site name and public URL every page uses for titles, the logo
 * and structured data. One hook keeps the fallback and trimming rules equal.
 */
const useSiteMeta = () => {
  const config = useConfig();

  return {
    siteName:
      ((config.get("general.appName") as string) ?? "").trim() ||
      DEFAULT_SITE_NAME,
    baseUrl: getPublicBaseUrl(config.get("general.appUrl") as string),
  };
};

export default useSiteMeta;
