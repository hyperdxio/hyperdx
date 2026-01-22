import { useEffect, useState } from 'react';
import Head from 'next/head';

import { DEFAULT_THEME, getTheme } from '@/theme';
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
 * HYDRATION NOTE: To avoid SSR/client mismatch, we render the default theme's
 * favicon during SSR and initial hydration, then update to the actual theme
 * after mount. This ensures consistent server/client rendering.
 */
export function DynamicFavicon() {
  const { theme } = useAppTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Use default theme favicon for SSR/initial render to match server
  // After mount, use the actual theme's favicon
  const defaultFavicon = getTheme(DEFAULT_THEME).favicon;
  const favicon = isMounted ? theme.favicon : defaultFavicon;

  return (
    <Head>
      {/* SVG favicon - modern browsers, scalable */}
      <link
        key="favicon-svg"
        rel="icon"
        type="image/svg+xml"
        href={favicon.svg}
      />

      {/* PNG fallbacks for older browsers */}
      <link
        key="favicon-32"
        rel="icon"
        type="image/png"
        sizes="32x32"
        href={favicon.png32}
      />
      <link
        key="favicon-16"
        rel="icon"
        type="image/png"
        sizes="16x16"
        href={favicon.png16}
      />

      {/* Apple Touch Icon for iOS */}
      <link
        key="apple-touch-icon"
        rel="apple-touch-icon"
        sizes="180x180"
        href={favicon.appleTouchIcon}
      />

      {/* Theme color for browser UI */}
      <meta key="theme-color" name="theme-color" content={favicon.themeColor} />
    </Head>
  );
}
