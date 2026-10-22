export const countryCodeToFlag = (code?: string) =>
  code && /^[A-Z]{2}$/.test(code) && code !== "T1"
    ? String.fromCodePoint(
        ...Array.from(code).map((char) => 127397 + char.charCodeAt(0)),
      )
    : "🌐";

export const getCountryName = (code: string, locale: string) => {
  if (code === "T1") return "Tor";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};
