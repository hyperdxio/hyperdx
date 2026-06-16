import { Head, Html, Main, NextScript } from 'next/document';

import { IS_CLICKHOUSE_BUILD } from '@/config';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';
import { themes } from '@/theme';

// Applied before React hydrates to prevent a flash of the wrong theme.
// Reads the runtime value from window.__ENV (set by __ENV.js) and swaps
// the theme class on <html> so CSS variables are correct on first paint.
const validThemes = Object.keys(themes);
const themeClasses = validThemes.map(t => `theme-${t}`);
const THEME_INIT_SCRIPT = `
(function () {
  var theme = window.__ENV && window.__ENV.NEXT_PUBLIC_THEME;
  var valid = ${JSON.stringify(validThemes)};
  if (valid.indexOf(theme) !== -1) {
    var html = document.documentElement;
    var remove = ${JSON.stringify(themeClasses)};
    for (var i = 0; i < remove.length; i++) html.classList.remove(remove[i]);
    html.classList.add('theme-' + theme);
  }
})();
`;

export default function Document() {
  const fontClasses = [
    ibmPlexMono.variable,
    robotoMono.variable,
    inter.variable,
    roboto.variable,
  ].join(' ');

  return (
    <Html lang="en" className={`${fontClasses} theme-hyperdx`}>
      <Head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/__ENV.js" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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
