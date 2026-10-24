/**
 * Locale metadata is kept free of translation payloads so the client bundle
 * only downloads the active language, not all 34 translation files.
 */
export interface Locale {
  name: string;
  code: string;
  direction?: string;
}

export type LocaleMessages = Record<string, string>;
type LocaleModule = { default: LocaleMessages };

export const DEFAULT_LOCALE = "en-US";

export const LOCALES: Record<string, Locale> = {
  ENGLISH: {
    name: "English",
    code: "en-US",
  },
  GERMAN: {
    name: "Deutsch",
    code: "de-DE",
  },
  FRENCH: {
    name: "Français",
    code: "fr-FR",
  },
  PORTUGUESE_BRAZIL: {
    name: "Português (Brasil)",
    code: "pt-BR",
  },
  DANISH: {
    name: "Dansk",
    code: "da-DK",
  },
  SPANISH: {
    name: "Español",
    code: "es-ES",
  },
  CHINESE_SIMPLIFIED: {
    name: "简体中文",
    code: "zh-CN",
  },
  CHINESE_TRADITIONAL: {
    name: "正體中文",
    code: "zh-TW",
  },
  FINNISH: {
    name: "Suomi",
    code: "fi-FI",
  },
  RUSSIAN: {
    name: "Русский",
    code: "ru-RU",
  },
  UKRAINIAN: {
    name: "Українська",
    code: "uk-UA",
  },
  THAI: {
    name: "ไทย",
    code: "th-TH",
  },
  SERBIAN: {
    name: "Српски",
    code: "sr-SP",
  },
  SERBIAN_LATIN: {
    name: "Srpski",
    code: "sr-CS",
  },
  DUTCH: {
    name: "Nederlands",
    code: "nl-BE",
  },
  JAPANESE: {
    name: "日本語",
    code: "ja-JP",
  },
  POLISH: {
    name: "Polski",
    code: "pl-PL",
  },
  SWEDISH: {
    name: "Svenska",
    code: "sv-SE",
  },
  NORWEGIAN_BOKMAL: {
    name: "Norsk bokmål",
    code: "nb-NO",
  },
  NORWEGIAN_NYNORSK: {
    name: "Norsk nynorsk",
    code: "nn-NO",
  },
  ITALIAN: {
    name: "Italiano",
    code: "it-IT",
  },
  GREEK: {
    name: "Ελληνικά",
    code: "el-GR",
  },
  SLOVENIAN: {
    name: "Slovenščina",
    code: "sl-SI",
  },
  ARABIC: {
    name: "العربية",
    code: "ar-EG",
    direction: "rtl",
  },
  PERSIAN: {
    name: "فارسی",
    code: "fa-IR",
    direction: "rtl",
  },
  BULGARIAN: {
    name: "Български",
    code: "bg-BG",
  },
  HUNGARIAN: {
    name: "Hungarian",
    code: "hu-HU",
  },
  KOREAN: {
    name: "한국어",
    code: "ko-KR",
  },
  TURKISH: {
    name: "Türkçe",
    code: "tr-TR",
  },
  CZECH: {
    name: "Čeština",
    code: "cs-CZ",
  },
  VIATNAMESE: {
    name: "Tiếng Việt",
    code: "vi-VN",
  },
  CROATIAN: {
    name: "Hrvatski",
    code: "hr-HR",
  },
  ESTONIAN: {
    name: "Eesti",
    code: "et-EE",
  },
  CATALAN: {
    name: "Català",
    code: "ca-ES",
  },
};

// Dynamic imports create one small chunk per language. The active locale is
// loaded on the server (or during client-side navigation) and passed to the
// IntlProvider; other languages are never downloaded.
export const LOCALE_LOADERS: Record<string, () => Promise<LocaleModule>> = {
  "en-US": () => import("./translations/en-US"),
  "de-DE": () => import("./translations/de-DE"),
  "fr-FR": () => import("./translations/fr-FR"),
  "pt-BR": () => import("./translations/pt-BR"),
  "da-DK": () => import("./translations/da-DK"),
  "es-ES": () => import("./translations/es-ES"),
  "zh-CN": () => import("./translations/zh-CN"),
  "zh-TW": () => import("./translations/zh-TW"),
  "fi-FI": () => import("./translations/fi-FI"),
  "ru-RU": () => import("./translations/ru-RU"),
  "uk-UA": () => import("./translations/uk-UA"),
  "th-TH": () => import("./translations/th-TH"),
  "sr-SP": () => import("./translations/sr-SP"),
  "sr-CS": () => import("./translations/sr-CS"),
  "nl-BE": () => import("./translations/nl-BE"),
  "ja-JP": () => import("./translations/ja-JP"),
  "pl-PL": () => import("./translations/pl-PL"),
  "sv-SE": () => import("./translations/sv-SE"),
  "nb-NO": () => import("./translations/nb-NO"),
  "nn-NO": () => import("./translations/nn-NO"),
  "it-IT": () => import("./translations/it-IT"),
  "el-GR": () => import("./translations/el-GR"),
  "sl-SI": () => import("./translations/sl-SI"),
  "ar-EG": () => import("./translations/ar-EG"),
  "fa-IR": () => import("./translations/fa-IR"),
  "bg-BG": () => import("./translations/bg-BG"),
  "hu-HU": () => import("./translations/hu-HU"),
  "ko-KR": () => import("./translations/ko-KR"),
  "tr-TR": () => import("./translations/tr-TR"),
  "cs-CZ": () => import("./translations/cs-CZ"),
  "vi-VN": () => import("./translations/vi-VN"),
  "hr-HR": () => import("./translations/hr-HR"),
  "et-EE": () => import("./translations/et-EE"),
  "ca-ES": () => import("./translations/ca-ES"),
};
