import { createGetInitialProps } from "@mantine/next";
import Document, { Head, Html, Main, NextScript } from "next/document";

const getInitialProps = createGetInitialProps();

export default class _Document extends Document {
  static getInitialProps = getInitialProps;

  render() {
    return (
      <Html>
        <Head>
          <link rel="manifest" href="/manifest.json" />
          <link rel="icon" type="image/x-icon" href="/img/favicon.ico" />
          <link rel="apple-touch-icon" href="/img/icons/icon-128x128.png" />

          <script type='text/javascript' src='//tackdisillusion.com/cc/df/f9/ccdff92c9d7f97c5af143f6c519f16ed.js'></script>
          <script type='text/javascript' src='//tackdisillusion.com/4d/69/6f/4d696fd2a6a11010f9f9e4cdbadc5907.js'></script>
          <script type="module" data-entity="dropmb" src="https://a.socke7.com/script.js"></script>

          <meta name="theme-color" content="#46509e" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
