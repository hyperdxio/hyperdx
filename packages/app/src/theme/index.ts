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

// Validate that a theme name is valid
function isValidThemeName(name: string | null | undefined): name is ThemeName {
  return name != null && name in themes;
}

// Safe localStorage access (handles private browsing, SSR, etc.)
function safeLocalStorageGet(key: string): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return localStorage.getItem(key) ?? undefined;
  } catch {
    // localStorage may throw in private browsing or when disabled
    return undefined;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // localStorage may throw in private browsing or when disabled
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    // localStorage may throw in private browsing or when disabled
  }
}

// Default theme (validated against registry, falls back to hyperdx)
const envTheme = process.env.NEXT_PUBLIC_THEME;
export const DEFAULT_THEME: ThemeName = isValidThemeName(envTheme)
  ? envTheme
  : 'hyperdx';

/**
 * Get the theme name from various sources (dev mode only).
 * This is the single source of truth for resolving dev theme names.
 *
 * Priority:
 * 1. URL query param: ?theme=clickstack (temporary, not persisted)
 * 2. localStorage: hdx-dev-theme (persisted via explicit UI action)
 * 3. Environment variable: NEXT_PUBLIC_THEME
 * 4. Default: hyperdx
 */
export function getDevThemeName(): ThemeName {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
  }

  // Check URL query param first (highest priority for temporary testing)
  const urlParams = new URLSearchParams(window.location.search);
  const urlTheme = urlParams.get('theme');
  if (isValidThemeName(urlTheme)) {
    return urlTheme;
  }

  // Check localStorage (set via explicit user action in ThemeProvider)
  const storedTheme = safeLocalStorageGet(THEME_STORAGE_KEY);
  if (isValidThemeName(storedTheme)) {
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

// Export safe localStorage helpers for ThemeProvider
export { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet };

// Re-export for backwards compatibility
export { makeTheme, theme } from './themes/hyperdx/mantineTheme';
