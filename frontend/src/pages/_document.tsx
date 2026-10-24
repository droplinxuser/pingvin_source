import { createGetInitialProps } from "@mantine/next";
import Document, { Head, Html, Main, NextScript } from "next/document";
import { DEFAULT_LOCALE, LOCALES } from "../i18n/locales";

const getInitialProps = createGetInitialProps();

export default class _Document extends Document {
  static getInitialProps = getInitialProps;

  render() {
    const language =
      (
        this.props as {
          __NEXT_DATA__?: { props?: { pageProps?: { language?: string } } };
        }
      ).__NEXT_DATA__?.props?.pageProps?.language ?? DEFAULT_LOCALE;
    const direction =
      Object.values(LOCALES).find((locale) => locale.code === language)
        ?.direction ?? "ltr";

    return (
      <Html lang={language} dir={direction}>
        <Head>
          <link rel="manifest" href="/manifest.json" />
          <link rel="icon" type="image/x-icon" href="/favicon.ico" />
          <link
            rel="icon"
            type="image/webp"
            href="/img/icons/icon-128x128.webp"
          />
          <link rel="apple-touch-icon" href="/img/icons/icon-128x128.png" />
          <meta name="theme-color" content="#46509e" />
          <meta name="color-scheme" content="light dark" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
