import { Head, Html, Main, NextScript } from 'next/document';

import { IS_CLICKHOUSE_BUILD } from '@/config';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';
import { THEME_NAMES, ThemeName } from '@/theme/types';

const VALID_THEME_NAMES = THEME_NAMES satisfies readonly ThemeName[];

function isValidThemeName(name: string | undefined): name is ThemeName {
  return VALID_THEME_NAMES.includes(name as ThemeName);
}

// Get theme class for SSR - must match ThemeProvider's resolution
// This ensures CSS variables are applied during server-side rendering
// to prevent hydration mismatch with button styling
function getThemeClass(): string {
  const envTheme = process.env.NEXT_PUBLIC_THEME;
  const themeName = isValidThemeName(envTheme) ? envTheme : 'hyperdx';
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
