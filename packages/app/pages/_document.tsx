import { Head, Html, Main, NextScript } from 'next/document';

import { IS_CLICKHOUSE_BUILD } from '@/config';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';

// Get theme class for SSR - must match ThemeProvider's resolution
// This ensures CSS variables are applied during server-side rendering
// to prevent hydration mismatch with button styling
function getThemeClass(): string {
  const envTheme = process.env.NEXT_PUBLIC_THEME;
  // Default to hyperdx if not set or invalid
  const themeName =
    envTheme === 'hyperdx' || envTheme === 'clickstack' ? envTheme : 'hyperdx';
  return `theme-${themeName}`;
}

export default function Document() {
  const fontClasses = [
    ibmPlexMono.variable,
    robotoMono.variable,
    inter.variable,
    roboto.variable,
  ].join(' ');

  const themeClass = getThemeClass();

  return (
    <Html lang="en" className={`${fontClasses} ${themeClass}`}>
      <Head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/__ENV.js" />
        {!IS_CLICKHOUSE_BUILD && (
          <>
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <script src="/pyodide/pyodide.js"></script>
          </>
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
