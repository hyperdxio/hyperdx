import Head from 'next/head';

import { useAppTheme } from '@/theme/ThemeProvider';

/**
 * Dynamic favicon component that updates based on the current theme.
 *
 * Favicon best practices (2024+):
 * - SVG favicon: Modern browsers, scalable, supports dark mode via CSS
 * - PNG 32x32: Standard fallback for older browsers
 * - PNG 16x16: Small contexts (bookmarks, tabs in some browsers)
 * - Apple Touch Icon: iOS home screen (180x180)
 * - theme-color: Browser UI color (address bar on mobile)
 *
 * This component must be rendered inside AppThemeProvider to access theme context.
 */
export function DynamicFavicon() {
  const { theme } = useAppTheme();
  const { favicon } = theme;

  return (
    <Head>
      {/* SVG favicon - modern browsers, scalable */}
      <link rel="icon" type="image/svg+xml" href={favicon.svg} />

      {/* PNG fallbacks for older browsers */}
      <link rel="icon" type="image/png" sizes="32x32" href={favicon.png32} />
      <link rel="icon" type="image/png" sizes="16x16" href={favicon.png16} />

      {/* Apple Touch Icon for iOS */}
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href={favicon.appleTouchIcon}
      />

      {/* Theme color for browser UI */}
      <meta name="theme-color" content={favicon.themeColor} />
    </Head>
  );
}
