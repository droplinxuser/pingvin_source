/**
 * Loads a single moment locale lazily. Keeping this map dynamic prevents the
 * whole locale catalogue from entering the main client bundle.
 */
const MOMENT_LOCALES: Record<string, string> = {
  "de-DE": "de",
  "fr-FR": "fr",
  "pt-BR": "pt-br",
  "da-DK": "da",
  "es-ES": "es",
  "zh-CN": "zh-cn",
  "zh-TW": "zh-tw",
  "fi-FI": "fi",
  "ru-RU": "ru",
  "uk-UA": "uk",
  "th-TH": "th",
  "sr-SP": "sr-cyrl",
  "sr-CS": "sr",
  "nl-BE": "nl-be",
  "ja-JP": "ja",
  "pl-PL": "pl",
  "sv-SE": "sv",
  "nb-NO": "nb",
  "nn-NO": "nn",
  "it-IT": "it",
  "el-GR": "el",
  "sl-SI": "sl",
  "ar-EG": "ar",
  "fa-IR": "fa",
  "bg-BG": "bg",
  "hu-HU": "hu",
  "ko-KR": "ko",
  "tr-TR": "tr",
  "cs-CZ": "cs",
  "vi-VN": "vi",
  "hr-HR": "hr",
  "et-EE": "et",
  "ca-ES": "ca",
};

const LOCALE_LOADERS: Record<string, () => Promise<unknown>> = {
  de: () => import("moment/locale/de"),
  fr: () => import("moment/locale/fr"),
  "pt-br": () => import("moment/locale/pt-br"),
  da: () => import("moment/locale/da"),
  es: () => import("moment/locale/es"),
  "zh-cn": () => import("moment/locale/zh-cn"),
  "zh-tw": () => import("moment/locale/zh-tw"),
  fi: () => import("moment/locale/fi"),
  ru: () => import("moment/locale/ru"),
  uk: () => import("moment/locale/uk"),
  th: () => import("moment/locale/th"),
  "sr-cyrl": () => import("moment/locale/sr-cyrl"),
  sr: () => import("moment/locale/sr"),
  "nl-be": () => import("moment/locale/nl-be"),
  ja: () => import("moment/locale/ja"),
  pl: () => import("moment/locale/pl"),
  sv: () => import("moment/locale/sv"),
  nb: () => import("moment/locale/nb"),
  nn: () => import("moment/locale/nn"),
  it: () => import("moment/locale/it"),
  el: () => import("moment/locale/el"),
  sl: () => import("moment/locale/sl"),
  ar: () => import("moment/locale/ar"),
  fa: () => import("moment/locale/fa"),
  bg: () => import("moment/locale/bg"),
  hu: () => import("moment/locale/hu"),
  ko: () => import("moment/locale/ko"),
  tr: () => import("moment/locale/tr"),
  cs: () => import("moment/locale/cs"),
  vi: () => import("moment/locale/vi"),
  hr: () => import("moment/locale/hr"),
  et: () => import("moment/locale/et"),
  ca: () => import("moment/locale/ca"),
};

export async function loadMomentLocale(languageCode: string) {
  const momentCode = MOMENT_LOCALES[languageCode];
  const loader = momentCode ? LOCALE_LOADERS[momentCode] : undefined;
  if (!loader) return;

  const [moment] = await Promise.all([import("moment"), loader()]);
  moment.default.locale(momentCode);
}
