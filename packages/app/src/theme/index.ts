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

// LocalStorage key for dev theme override
const THEME_STORAGE_KEY = 'hdx-dev-theme';

// Default theme (can be overridden via environment variable)
export const DEFAULT_THEME: ThemeName =
  (process.env.NEXT_PUBLIC_THEME as ThemeName) || 'hyperdx';

/**
 * Get the theme name from various sources (dev mode only):
 * 1. URL query param: ?theme=clickstack
 * 2. localStorage: hdx-dev-theme
 * 3. Environment variable: NEXT_PUBLIC_THEME
 * 4. Default: hyperdx
 */
function getDevThemeName(): ThemeName {
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

/**
 * Set the dev theme (persists to localStorage)
 * Only works in development mode
 */
export function setDevTheme(name: ThemeName): void {
  if (!IS_DEV) {
    console.warn('setDevTheme only works in development mode');
    return;
  }
  if (typeof window !== 'undefined' && themes[name]) {
    localStorage.setItem(THEME_STORAGE_KEY, name);
    // Reload to apply theme
    window.location.reload();
  }
}

/**
 * Clear the dev theme override (reverts to default)
 */
export function clearDevTheme(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(THEME_STORAGE_KEY);
    window.location.reload();
  }
}

/**
 * Toggle between themes (useful for keyboard shortcut)
 */
export function toggleDevTheme(): void {
  if (!IS_DEV) return;
  const current = getDevThemeName();
  const themeNames = Object.keys(themes) as ThemeName[];
  const currentIndex = themeNames.indexOf(current);
  const nextIndex = (currentIndex + 1) % themeNames.length;
  setDevTheme(themeNames[nextIndex]);
}

// Get theme configuration
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
