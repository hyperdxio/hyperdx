import { clickstackTheme } from './themes/clickstack';
import { hyperdxTheme } from './themes/hyperdx';
import { ThemeConfig, ThemeName } from './types';

/**
 * Brand Theme System
 *
 * DESIGN DECISION: Brand theme (hyperdx/clickstack) is DEPLOYMENT-CONFIGURED, not user-selectable.
 *
 * - Production: Theme is set via NEXT_PUBLIC_THEME environment variable at build/deploy time.
 *   Each deployment is branded for a specific product (HyperDX or ClickStack).
 *   Users cannot and should not change the brand theme.
 *
 * - Development: Theme switching is enabled for testing via:
 *   - localStorage: hdx-dev-theme (persisted via dev UI)
 *
 * This is intentionally different from colorMode (light/dark), which IS user-selectable.
 */

// Theme registry
export const themes: Record<ThemeName, ThemeConfig> = {
  hyperdx: hyperdxTheme,
  clickstack: clickstackTheme,
};

// Check if we're in development/local mode
export const IS_DEV =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_IS_LOCAL_MODE === 'true';

// LocalStorage key for dev theme override (exported for ThemeProvider)
export const THEME_STORAGE_KEY = 'hdx-dev-theme';

// Validate that a theme name is valid
export function isValidThemeName(
  name: string | null | undefined,
): name is ThemeName {
  return name != null && name in themes;
}

// Safe localStorage access (handles private browsing, SSR, etc.)
export function safeLocalStorageGet(key: string): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return localStorage.getItem(key) ?? undefined;
  } catch {
    // localStorage may throw in private browsing or when disabled
    return undefined;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // localStorage may throw in private browsing or when disabled
  }
}

export function safeLocalStorageRemove(key: string): void {
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
 * 1. localStorage: hdx-dev-theme (persisted via explicit UI action)
 * 2. Environment variable: NEXT_PUBLIC_THEME
 * 3. Default: hyperdx
 */
export function getDevThemeName(): ThemeName {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
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

/**
 * IMPORTANT: To get the current theme in React components, use `useAppTheme()` hook
 * from `./ThemeProvider` instead of calling these functions directly.
 *
 * Why?
 * - `useAppTheme()` ensures consistency with ThemeProvider context
 * - Prevents hydration mismatches between SSR and client-side rendering
 * - Properly handles theme switching in dev mode
 * - Matches the theme resolution used throughout the app
 *
 * Example:
 * ```tsx
 * import { useAppTheme } from '@/theme/ThemeProvider';
 *
 * function MyComponent() {
 *   const { theme, themeName } = useAppTheme();
 *   return <div>{theme.displayName}</div>;
 * }
 * ```
 *
 * These utility functions (`getTheme`, `getDevThemeName`) are for internal use
 * by ThemeProvider and should not be used directly in components.
 */

// Re-export types
export type { ThemeConfig, ThemeName } from './types';

// Re-export for backwards compatibility
export { makeTheme, theme } from './themes/hyperdx/mantineTheme';
