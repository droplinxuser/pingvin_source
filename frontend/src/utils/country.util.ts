export const countryCodeToFlag = (code?: string) =>
  code && /^[A-Z]{2}$/.test(code) && code !== "T1"
    ? String.fromCodePoint(
        ...Array.from(code).map((char) => 127397 + char.charCodeAt(0)),
      )
    : "🌐";

const countryNames = new Map<string, Intl.DisplayNames | null>();

export const getCountryName = (code: string, locale: string) => {
  if (code === "T1") return "Tor";

  let displayNames = countryNames.get(locale);
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      displayNames = null;
    }
    countryNames.set(locale, displayNames);
  }

  return displayNames?.of(code) ?? code;
};
