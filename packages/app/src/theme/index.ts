import { clickstackTheme } from './themes/clickstack';
import { hyperdxTheme } from './themes/hyperdx';
import { ThemeConfig, ThemeName } from './types';

// Theme registry
export const themes: Record<ThemeName, ThemeConfig> = {
  hyperdx: hyperdxTheme,
  clickstack: clickstackTheme,
};

// Check if we're in development/local mode
const IS_DEV =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_IS_LOCAL_MODE === 'true';

// LocalStorage key for dev theme override (exported for ThemeProvider)
export const THEME_STORAGE_KEY = 'hdx-dev-theme';

// Default theme (can be overridden via environment variable)
export const DEFAULT_THEME: ThemeName =
  (process.env.NEXT_PUBLIC_THEME as ThemeName) || 'hyperdx';

/**
 * Get the theme name from various sources (dev mode only).
 * This is the single source of truth for resolving dev theme names.
 *
 * Priority:
 * 1. URL query param: ?theme=clickstack
 * 2. localStorage: hdx-dev-theme
 * 3. Environment variable: NEXT_PUBLIC_THEME
 * 4. Default: hyperdx
 *
 * Note: URL params are persisted to localStorage when detected.
 */
export function getDevThemeName(): ThemeName {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
  }

  // Check URL query param first (highest priority for testing)
  const urlParams = new URLSearchParams(window.location.search);
  const urlTheme = urlParams.get('theme') as ThemeName | null;
  if (urlTheme && themes[urlTheme]) {
    // Persist to localStorage when set via URL
    localStorage.setItem(THEME_STORAGE_KEY, urlTheme);
    return urlTheme;
  }

  // Check localStorage
  const storedTheme = localStorage.getItem(
    THEME_STORAGE_KEY,
  ) as ThemeName | null;
  if (storedTheme && themes[storedTheme]) {
    return storedTheme;
  }

  return DEFAULT_THEME;
}

// Get theme configuration by name
export function getTheme(name: ThemeName = DEFAULT_THEME): ThemeConfig {
  return themes[name] || themes.hyperdx;
}

// Get current theme based on environment and dev overrides
export function getCurrentTheme(): ThemeConfig {
  const themeName = IS_DEV ? getDevThemeName() : DEFAULT_THEME;
  return getTheme(themeName);
}

// Get current theme name
export function getCurrentThemeName(): ThemeName {
  return IS_DEV ? getDevThemeName() : DEFAULT_THEME;
}

// Re-export types
export type { ThemeConfig, ThemeName } from './types';

// Re-export for backwards compatibility
export { makeTheme, theme } from './themes/hyperdx/mantineTheme';
