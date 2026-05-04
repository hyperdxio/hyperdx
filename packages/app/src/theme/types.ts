import React from 'react';
import { MantineThemeOverride } from '@mantine/core';

/**
 * ============================================================================
 * THEMING CONCEPTS: Color Mode vs Brand Theme
 * ============================================================================
 *
 * This codebase has TWO separate theming concepts:
 *
 * 1. COLOR MODE (light/dark/system)
 *    - User-selectable preference stored in `useUserPreferences().colorMode`
 *    - 'system' follows OS prefers-color-scheme; default is 'system'
 *    - Affects visual appearance: backgrounds, text colors, etc.
 *    - Managed by Mantine's color scheme system
 *    - Persisted to localStorage via `hdx-user-preferences`
 *
 * 2. BRAND THEME (hyperdx/clickstack)
 *    - Deployment-configured, NOT user-selectable in production
 *    - Set via `NEXT_PUBLIC_THEME` environment variable
 *    - Affects branding: logos, accent colors, favicons
 *    - Each deployment is branded for one specific product
 *    - Dev mode allows switching via localStorage (set via dev UI)
 *
 * WHY SEPARATE?
 * - Color mode is personal preference (accessibility, comfort)
 * - Brand theme is business identity (product differentiation)
 * - A ClickStack deployment should never show HyperDX branding, regardless of color mode
 *
 * @see useUserPreferences - manages colorMode (user preference)
 * @see AppThemeProvider - manages brand theme (deployment config)
 */

/**
 * Brand theme identifier.
 * This is DEPLOYMENT-CONFIGURED, not user-selectable in production.
 */
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
  Wordmark: React.ComponentType;
  Logomark: React.ComponentType<{ size?: number }>;
  cssClass: string; // Applied to html element for CSS variable scoping
  favicon: FaviconConfig;
}
