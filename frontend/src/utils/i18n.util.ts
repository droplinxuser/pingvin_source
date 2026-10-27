import { setCookie } from "cookies-next/client";
import english from "../i18n/translations/en-US";
import { DEFAULT_LOCALE, LOCALE_LOADERS, LOCALES } from "../i18n/locales";
import type { Locale, LocaleMessages } from "../i18n/locales";

type LoadedLocale = Locale & { messages: LocaleMessages };

const englishLocale: LoadedLocale = {
  ...LOCALES.ENGLISH,
  messages: english,
};

// Only the active language (merged with the English fallback) is kept here.
// The full translation catalogue stays in lazy chunks.
const localeCache = new Map<string, LoadedLocale>([
  [englishLocale.code, englishLocale],
]);

const findLocale = (code?: string): Locale => {
  const locales = Object.values(LOCALES);
  const exact = locales.find((locale) => locale.code === code);
  if (exact) return exact;

  const base = code?.split("-")[0].toLowerCase();
  return (
    locales.find(
      (locale) => locale.code.split("-")[0].toLowerCase() === base,
    ) ?? LOCALES.ENGLISH
  );
};

/**
 * Seeds the synchronous cache after the server passed the active messages in
 * page props. This keeps `translateOutsideContext` working for modals.
 */
export const setLocaleMessages = (code: string, messages: LocaleMessages) => {
  const locale = findLocale(code);
  localeCache.set(locale.code, { ...locale, messages });
};

/**
 * Loads one locale on the server (or for client navigation) and merges the
 * English fallback so missing fork-only keys never render as raw message IDs.
 */
export const loadLocale = async (code?: string): Promise<LoadedLocale> => {
  const locale = findLocale(code);
  const cached = localeCache.get(locale.code);
  if (cached) return cached;

  const loader = LOCALE_LOADERS[locale.code];
  const loaded = loader ? (await loader()).default : {};
  const merged = {
    ...locale,
    messages: { ...english, ...loaded },
  };
  localeCache.set(locale.code, merged);
  return merged;
};

const getLocaleByCode = (code: string): LoadedLocale => {
  const locale = findLocale(code);
  // If the locale chunk has not been loaded yet, render English rather than
  // blocking the UI or showing raw message IDs.
  return localeCache.get(locale.code) ?? englishLocale;
};

// Parse the Accept-Language header and return the first supported language
const getLanguageFromAcceptHeader = (acceptLanguage?: string) => {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const languages = acceptLanguage.split(",").map((l) => l.split(";")[0]);
  const supportedLanguages = Object.values(LOCALES).map((l) => l.code);
  const supportedLanguagesWithoutRegion = supportedLanguages.map(
    (l) => l.split("-")[0],
  );

  for (const language of languages) {
    // Try to match the full language code first, then the language code without the region
    if (supportedLanguages.includes(language)) {
      return language;
    } else if (
      supportedLanguagesWithoutRegion.includes(language.split("-")[0])
    ) {
      const similarLanguage = supportedLanguages.find((l) =>
        l.startsWith(language.split("-")[0]),
      );
      return similarLanguage;
    }
  }
  return DEFAULT_LOCALE;
};

const isLanguageSupported = (code: string) => {
  return Object.values(LOCALES).some((l) => l.code === code);
};

const setLanguageCookie = (code: string) => {
  setCookie("language", code, {
    sameSite: "lax",
    expires: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
  });
};

export default {
  getLocaleByCode,
  loadLocale,
  setLocaleMessages,
  getLanguageFromAcceptHeader,
  isLanguageSupported,
  setLanguageCookie,
};
