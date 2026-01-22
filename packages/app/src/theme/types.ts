import { MantineThemeOverride } from '@mantine/core';

export type ThemeName = 'hyperdx' | 'clickstack';

/**
 * Favicon configuration for a theme.
 * Modern best practice includes multiple formats for broad compatibility.
 */
export interface FaviconConfig {
  /** SVG favicon - best for modern browsers, scalable */
  svg: string;
  /** PNG 32x32 - standard fallback */
  png32: string;
  /** PNG 16x16 - for small contexts */
  png16: string;
  /** Apple Touch Icon 180x180 - for iOS home screen */
  appleTouchIcon: string;
  /** Theme color for browser UI (address bar, etc.) */
  themeColor: string;
}

export interface ThemeConfig {
  name: ThemeName;
  displayName: string;
  mantineTheme: MantineThemeOverride;
  Wordmark: React.ComponentType<{ size?: 'sm' | 'md' | 'lg' | 'xl' }>;
  Logomark: React.ComponentType<{ size?: number }>;
  cssClass: string; // Applied to html element for CSS variable scoping
  favicon: FaviconConfig;
}
