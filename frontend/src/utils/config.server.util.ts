import type Config from "../types/config.type";
import { getDefaultConfig } from "./defaultConfig.util";
import { withBuildVersion } from "./version.util";

type ConfigResponse = {
  config: Config[];
  fallback: boolean;
};

const CONFIG_CACHE_TTL_MS = 30_000;
const CONFIG_FALLBACK_TTL_MS = 5_000;
let cached: { at: number; value: ConfigResponse } | undefined;

/**
 * Loads the public config on the server (middleware, _app and the dynamic
 * manifest). The config is the same for every visitor, so a short module-level
 * cache keeps SSR and middleware reads off the backend. A short timeout keeps
 * an unavailable backend from blocking page rendering; the bundled defaults
 * are used instead.
 */
export async function fetchConfig(apiUrl: string): Promise<ConfigResponse> {
  const maxAge = cached?.value.fallback
    ? CONFIG_FALLBACK_TTL_MS
    : CONFIG_CACHE_TTL_MS;
  if (cached && Date.now() - cached.at < maxAge) return cached.value;

  try {
    const response = await fetch(withBuildVersion(`${apiUrl}/api/configs`), {
      cache: "no-store",
      signal: AbortSignal.timeout(1000),
    });

    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status}`);
    }

    const value = {
      config: (await response.json()) as Config[],
      fallback: false,
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    const value = { config: getDefaultConfig(), fallback: true };
    cached = { at: Date.now(), value };
    return value;
  }
}
