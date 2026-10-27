import {
  Box,
  ColorScheme,
  ColorSchemeProvider,
  Container,
  MantineThemeOverride,
  MantineProvider,
  Stack,
} from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { getCookie, setCookie } from "cookies-next";
import { GetServerSidePropsContext } from "next";
import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, IntlProvider } from "react-intl";
import Header from "../components/header/Header";
import { ConfigContext } from "../hooks/config.hook";
import { UserContext } from "../hooks/user.hook";
import { LOCALES } from "../i18n/locales";
import authService from "../services/auth.service";
import configService from "../services/config.service";
import userService from "../services/user.service";
import GlobalStyle from "../styles/global.style";
import globalStyle from "../styles/mantine.style";
import Config from "../types/config.type";
import { CurrentUser } from "../types/user.type";
import i18nUtil from "../utils/i18n.util";
import { isPublicPageRoute } from "../utils/router.util";
import { getConfigValue } from "../utils/seo.util";
import userPreferences from "../utils/userPreferences.util";
import Footer from "../components/footer/Footer";
import { installGlobalErrorReporter } from "../utils/errorReporter.util";
import AdminNoticeModal, {
  AdminNotice,
} from "../components/admin/AdminNoticeModal";
import adminNoticeService from "../services/adminNotice.service";
import SiteStructuredData from "../components/SiteStructuredData";
import RouteProgress from "../components/core/RouteProgress";

const TrendingToday = dynamic(
  () => import("../components/share/TrendingToday"),
  { ssr: true },
);

const excludeDefaultLayoutRoutes = ["/admin/config/[category]"];

// Install before hydration so early client errors are reported too. The guard
// inside the helper keeps hot reloads from registering duplicate listeners.
if (typeof window !== "undefined") installGlobalErrorReporter();

const trendingWidgetRoutes = ["/share/[shareId]", "/404"];
const availableMantineColors = [
  "dark",
  "gray",
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
  "victoria",
] as const;
const availableMantineRadii = ["xs", "sm", "md", "lg", "xl"] as const;
const hexColorPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeHexColor = (value: string): string | null => {
  if (!hexColorPattern.test(value)) return null;
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return value.toLowerCase();
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const mixHexColors = (
  baseHex: string,
  mixHex: string,
  weight: number,
): string => {
  const base = hexToRgb(baseHex);
  const mix = hexToRgb(mixHex);
  const inverseWeight = 1 - weight;

  return rgbToHex(
    base.r * inverseWeight + mix.r * weight,
    base.g * inverseWeight + mix.g * weight,
    base.b * inverseWeight + mix.b * weight,
  );
};

const createMantineScaleFromHex = (hex: string) =>
  [
    mixHexColors(hex, "#ffffff", 0.92),
    mixHexColors(hex, "#ffffff", 0.82),
    mixHexColors(hex, "#ffffff", 0.68),
    mixHexColors(hex, "#ffffff", 0.54),
    mixHexColors(hex, "#ffffff", 0.36),
    hex,
    mixHexColors(hex, "#000000", 0.1),
    mixHexColors(hex, "#000000", 0.22),
    mixHexColors(hex, "#000000", 0.34),
    mixHexColors(hex, "#000000", 0.46),
  ] as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

function App({ Component, pageProps }: AppProps) {
  const systemTheme = useColorScheme(pageProps.colorScheme);
  const router = useRouter();

  const [colorScheme, setColorScheme] = useState<ColorScheme>(systemTheme);

  const [user, setUser] = useState<CurrentUser | null>(pageProps.user);
  const initialLanguage = pageProps.language ?? LOCALES.ENGLISH.code;
  const [messages, setMessages] = useState<Record<string, string>>(
    pageProps.messages ?? i18nUtil.getLocaleByCode(initialLanguage).messages,
  );
  if (pageProps.messages) {
    i18nUtil.setLocaleMessages(initialLanguage, pageProps.messages);
  }

  const [configVariables, setConfigVariables] = useState<Config[]>(
    pageProps.configVariables,
  );
  const getStringConfigValue = (key: string, fallback = ""): string =>
    getConfigValue(configVariables, key) || fallback;

  const customCss = getStringConfigValue("appearance.customCss");
  const themePrimaryColorRaw = getStringConfigValue(
    "appearance.themePrimaryColor",
    "victoria",
  );
  const themePrimaryColorOverrideRaw = getStringConfigValue(
    "appearance.themePrimaryColorOverride",
  );
  const themeRadiusRaw = getStringConfigValue("appearance.themeRadius", "sm");
  const themeColorSchemeRaw = getStringConfigValue(
    "appearance.themeColorScheme",
    "system",
  );

  const normalizedPrimaryColorOverrideHex = normalizeHexColor(
    themePrimaryColorOverrideRaw,
  );
  const useCustomPrimaryColor = themePrimaryColorRaw === "custom";

  const effectivePrimaryHex = useCustomPrimaryColor
    ? normalizedPrimaryColorOverrideHex
    : null;

  const themePrimaryColor = effectivePrimaryHex
    ? "adminPrimary"
    : (availableMantineColors as readonly string[]).includes(
          themePrimaryColorRaw,
        )
      ? themePrimaryColorRaw
      : "victoria";

  const themeRadius = (availableMantineRadii as readonly string[]).includes(
    themeRadiusRaw,
  )
    ? themeRadiusRaw
    : "sm";

  const adminDefaultColorScheme =
    themeColorSchemeRaw === "light" || themeColorSchemeRaw === "dark"
      ? themeColorSchemeRaw
      : "system";

  const adminTheme: MantineThemeOverride = {
    ...(effectivePrimaryHex
      ? {
          colors: {
            adminPrimary: createMantineScaleFromHex(effectivePrimaryHex),
          },
        }
      : {}),
    primaryColor: themePrimaryColor,
    defaultRadius: themeRadius,
  };

  const mergedTheme: MantineThemeOverride = {
    ...globalStyle,
    ...adminTheme,
    colorScheme,
    colors: {
      ...(globalStyle.colors ?? {}),
      ...(adminTheme.colors ?? {}),
    },
  };

  // Version the service worker URL so browsers fetch the new worker even if
  // Cloudflare or the browser has cached /sw.js from a previous deployment.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const version = process.env.COMMIT_HASH || process.env.VERSION;
    navigator.serviceWorker
      .register(`/sw.js?v=${version}`, { updateViaCache: "none" })
      .catch(() => {});
  }, []);

  // Public pages are rendered as anonymous shells. Restore the real user
  // immediately in the browser so the header and owner actions stay correct.
  useEffect(() => {
    if (pageProps.user || !getCookie("access_token")) return;

    userService
      .getCurrentUser()
      .then((currentUser) => {
        if (currentUser) setUser(currentUser);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(
      async () => await authService.refreshAccessToken(),
      2 * 60 * 1000, // 2 minutes
    );

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!pageProps.language) return;
    const cookieLanguage = getCookie("language");
    if (!cookieLanguage) {
      if (!pageProps.isConfigFallback) {
        i18nUtil.setLanguageCookie(pageProps.language);
      }
    } else if (pageProps.language !== cookieLanguage) {
      // A CDN-cached page may be rendered in the default language. Add the
      // language to the URL so the CDN cache key differs from the default
      // version, then let the origin render the visitor's language.
      const url = new URL(location.href);
      if (url.searchParams.get("lang") !== cookieLanguage) {
        url.searchParams.set("lang", cookieLanguage);
        location.replace(url.toString());
      }
    }

    const current = i18nUtil.getLocaleByCode(pageProps.language);

    document.documentElement.dir = current.direction ?? "ltr";
    document.documentElement.lang = current.code;
  }, [pageProps.language, pageProps.isConfigFallback]);

  useEffect(() => {
    const userColorPreference = userPreferences.get("colorScheme");
    const colorScheme = user
      ? userColorPreference === "system"
        ? systemTheme
        : userColorPreference
      : adminDefaultColorScheme === "system"
        ? systemTheme
        : adminDefaultColorScheme;

    toggleColorScheme(colorScheme);
  }, [adminDefaultColorScheme, systemTheme, user]);

  const toggleColorScheme = (value: ColorScheme) => {
    setColorScheme(value ?? "light");
    setCookie("mantine-color-scheme", value ?? "light", {
      sameSite: "lax",
    });
  };

  const language = useRef(pageProps.language ?? LOCALES.ENGLISH.code);
  const [, setMomentLocaleVersion] = useState(0);

  // Moment's locale catalogue is large. Load only the active locale after
  // hydration instead of bundling every locale into the main chunk.
  useEffect(() => {
    if (language.current === LOCALES.ENGLISH.code) return;
    let cancelled = false;

    import("../utils/momentLocale.util")
      .then(({ loadMomentLocale }) => loadMomentLocale(language.current))
      .then(() => {
        if (!cancelled) setMomentLocaleVersion((version) => version + 1);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pageProps.messages) return;
    i18nUtil.setLocaleMessages(initialLanguage, pageProps.messages);
    setMessages(pageProps.messages);
  }, [initialLanguage, pageProps.messages]);

  const [pendingNotices, setPendingNotices] = useState<AdminNotice[]>([]);

  useEffect(() => {
    if (user?.isAdmin) {
      adminNoticeService
        .getPendingNotices()
        .then((notices) => {
          if (notices && Array.isArray(notices)) {
            setPendingNotices(notices);
          }
        })
        .catch(() => {});
    }
  }, [user?.id, user?.isAdmin]);

  const showTrending = trendingWidgetRoutes.includes(router.pathname);

  const handleDismissNotice = async (noticeId: string) => {
    setPendingNotices((prev) => prev.filter((n) => n.id !== noticeId));
    try {
      await adminNoticeService.dismissNotice(noticeId);
    } catch {
      adminNoticeService
        .getPendingNotices()
        .then((notices) => setPendingNotices(notices || []))
        .catch(() => {});
    }
  };

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <IntlProvider
        messages={messages}
        locale={language.current}
        defaultLocale={LOCALES.ENGLISH.code}
      >
        <MantineProvider withGlobalStyles withNormalizeCSS theme={mergedTheme}>
          {customCss && (
            <style id="admin-custom-css">
              {customCss.replace(/<\/style/gi, "<\\/style")}
            </style>
          )}
          <ColorSchemeProvider
            colorScheme={colorScheme}
            toggleColorScheme={toggleColorScheme}
          >
            <GlobalStyle />
            <RouteProgress />
            <Notifications />
            <ModalsProvider>
              <ConfigContext.Provider
                value={{
                  configVariables,
                  refresh: async () => {
                    setConfigVariables(await configService.list());
                  },
                }}
              >
                <UserContext.Provider
                  value={{
                    user,
                    refreshUser: async () => {
                      const user = await userService.getCurrentUser();
                      setUser(user);
                      return user;
                    },
                  }}
                >
                  <a className="skip-link" href="#main-content">
                    <FormattedMessage id="common.custom.skip-to-content" />
                  </a>
                  <AdminNoticeModal
                    notice={pendingNotices[0] || null}
                    onDismiss={handleDismissNotice}
                  />
                  <SiteStructuredData />
                  {excludeDefaultLayoutRoutes.includes(router.pathname) ? (
                    // AppShell renders its own <main>; a second one here would
                    // create duplicate landmarks.
                    <Box id="main-content">
                      <Component {...pageProps} />
                    </Box>
                  ) : (
                    <Stack sx={{ minHeight: "100vh" }}>
                      <Header />
                      <Box component="main" id="main-content" sx={{ flex: 1 }}>
                        <Container>
                          <Component {...pageProps} />
                        </Container>
                        {showTrending && <TrendingToday />}
                      </Box>
                      <Footer />
                    </Stack>
                  )}
                </UserContext.Provider>
              </ConfigContext.Provider>
            </ModalsProvider>
          </ColorSchemeProvider>
        </MantineProvider>
      </IntlProvider>
    </>
  );
}

// Fetch user and config variables on server side when the first request is made
// These will get passed as a page prop to the App component and stored in the contexts
App.getInitialProps = async ({
  ctx,
}: {
  ctx: GetServerSidePropsContext & { pathname?: string };
}) => {
  let pageProps: {
    user?: CurrentUser;
    configVariables?: Config[];
    colorScheme: ColorScheme;
    language?: string;
    messages?: Record<string, string>;
    isConfigFallback?: boolean;
  } = {
    colorScheme:
      (getCookie("mantine-color-scheme", ctx) as ColorScheme) ?? "light",
  };

  if (ctx.req) {
    const apiURL = process.env.API_URL || "http://localhost:8080";
    const cookieHeader = ctx.req.headers.cookie;

    // Load the server-only config helper lazily so its defaults and fetch code
    // do not end up in the public client chunk.
    const { fetchConfig } = await import("../utils/config.server.util");

    // Start the public config request before the account lookup so SSR only
    // waits for the slower of the two, not for both in sequence.
    const configRequest = fetchConfig(apiURL);

    // Never put account data in a shell that may be cached by the CDN, even
    // when an edge Cache Rule ignores the origin's no-store header. The client
    // restores the signed-in user from the access token after hydration.
    const requestPath = (ctx.req.url || "/").split("?")[0];
    if (!isPublicPageRoute(requestPath) && ctx.req.cookies.access_token) {
      pageProps.user = await fetch(`${apiURL}/api/users/me`, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
    }

    const { config, fallback } = await configRequest;
    pageProps.configVariables = config;
    pageProps.isConfigFallback = fallback;

    const requestLanguage = i18nUtil.getLanguageFromAcceptHeader(
      ctx.req.headers["accept-language"],
    );

    const defaultLanguage = pageProps.configVariables?.find(
      (item) => item.key === "general.defaultLanguage",
    )?.value;

    // Never pass a raw cookie value to IntlProvider: a malformed tag throws a
    // RangeError and would 500 every page for that browser.
    const cookieLanguage = ctx.req.cookies["language"];
    pageProps.language =
      typeof cookieLanguage === "string" &&
      i18nUtil.isLanguageSupported(cookieLanguage)
        ? cookieLanguage
        : typeof defaultLanguage === "string" &&
            i18nUtil.isLanguageSupported(defaultLanguage)
          ? defaultLanguage
          : requestLanguage;

    // Ship only the active language. The full translation catalogue remains in
    // lazy chunks instead of the main client bundle.
    pageProps.messages = (
      await i18nUtil.loadLocale(pageProps.language)
    ).messages;
  }
  return { pageProps };
};

export default App;
