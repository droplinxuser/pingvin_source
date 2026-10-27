import { ConfigService } from "src/config/config.service";

/**
 * Cookies must carry the Secure flag whenever the configured public URL uses
 * HTTPS. Relying on the admin setting alone means a server that is served over
 * TLS with the default `secureCookies=false` would still send auth cookies over
 * plaintext if the origin is ever reached directly.
 */
export function useSecureCookies(config: ConfigService): boolean {
  if (config.get("security.secureCookies") === true) return true;

  const appUrl = String(config.get("general.appUrl") ?? "").trim();
  return /^https:\/\//i.test(appUrl);
}
