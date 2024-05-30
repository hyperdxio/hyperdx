import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <script src="/__ENV.js" />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
