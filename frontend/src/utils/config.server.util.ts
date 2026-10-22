import type Config from "../types/config.type";
import { getDefaultConfig } from "./defaultConfig.util";

type ConfigResponse = {
  config: Config[];
  fallback: boolean;
};

/**
 * Loads the public config on the server (middleware, _app and the dynamic
 * manifest). A short timeout keeps an unavailable backend from blocking page
 * rendering; the bundled defaults are used instead.
 */
export async function fetchConfig(
  apiUrl: string,
  cookie?: string,
): Promise<ConfigResponse> {
  try {
    const response = await fetch(`${apiUrl}/api/configs`, {
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(1000),
    });

    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status}`);
    }

    return { config: (await response.json()) as Config[], fallback: false };
  } catch (error) {
    console.error("Config fetch failed, using defaults:", error);
    return { config: getDefaultConfig(), fallback: true };
  }
}
