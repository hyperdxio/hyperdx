import { z } from 'zod';

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

// Zod schema for validating ThemeConfig structure
// Note: React components and MantineThemeOverride are validated at runtime
// but cannot be fully validated with Zod schemas
const faviconConfigSchema = z.object({
  svg: z.string().min(1),
  png32: z.string().min(1),
  png16: z.string().min(1),
  appleTouchIcon: z.string().min(1),
  themeColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color'),
});

const themeConfigSchema = z.object({
  name: z.enum(['hyperdx', 'clickstack']),
  displayName: z.string().min(1),
  cssClass: z.string().min(1),
  favicon: faviconConfigSchema,
  // Wordmark and Logomark are React components - validate they exist and are callable
  Wordmark: z
    .any()
    .refine(
      val => typeof val === 'function' || (val && typeof val === 'object'),
      'Wordmark must be a React component',
    ),
  Logomark: z
    .any()
    .refine(
      val => typeof val === 'function' || (val && typeof val === 'object'),
      'Logomark must be a React component',
    ),
  // mantineTheme is complex - just check it exists
  mantineTheme: z
    .any()
    .refine(
      val => val !== null && val !== undefined,
      'mantineTheme must be defined',
    ),
});

/**
 * Validates a theme configuration at runtime.
 * Throws an error with details if validation fails.
 *
 * @param theme - Theme configuration to validate
 * @param themeName - Name of the theme (for error messages)
 * @throws Error if theme is invalid
 */
function validateThemeConfig(
  theme: unknown,
  themeName: string,
): asserts theme is ThemeConfig {
  try {
    themeConfigSchema.parse(theme);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new Error(
        `Invalid theme configuration for "${themeName}": ${details}`,
      );
    }
    throw error;
  }
}

// Validate themes at module load time
try {
  validateThemeConfig(hyperdxTheme, 'hyperdx');
  validateThemeConfig(clickstackTheme, 'clickstack');
} catch (error) {
  // Log error but don't crash - fallback to default theme
  console.error(
    '[Theme Validation] Failed to validate theme configurations:',
    error,
  );
  // In production, we might want to throw to prevent deployment with invalid configs
  if (process.env.NODE_ENV === 'production') {
    throw error;
  }
}

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
let resolvedDefaultTheme: ThemeName = isValidThemeName(envTheme)
  ? envTheme
  : 'hyperdx';

// Validate that the resolved default theme exists and is valid
if (!themes[resolvedDefaultTheme]) {
  console.warn(
    `[Theme Validation] Theme "${resolvedDefaultTheme}" from NEXT_PUBLIC_THEME not found in registry. Falling back to "hyperdx".`,
  );
  resolvedDefaultTheme = 'hyperdx';
} else {
  // Validate the theme config structure
  try {
    validateThemeConfig(themes[resolvedDefaultTheme], resolvedDefaultTheme);
  } catch (error) {
    console.error(
      `[Theme Validation] Theme "${resolvedDefaultTheme}" failed validation. Falling back to "hyperdx".`,
      error,
    );
    resolvedDefaultTheme = 'hyperdx';
    // In production, throw to prevent deployment with invalid configs
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

export const DEFAULT_THEME: ThemeName = resolvedDefaultTheme;

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
  const theme = themes[name] || themes.hyperdx;

  // Runtime validation - ensure theme is valid before returning
  // This catches cases where theme config was corrupted after module load
  try {
    validateThemeConfig(theme, name);
  } catch (error) {
    console.error(
      `[Theme Validation] Theme "${name}" failed runtime validation. Falling back to "hyperdx".`,
      error,
    );
    // Return hyperdx theme as safe fallback
    return themes.hyperdx;
  }

  return theme;
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
