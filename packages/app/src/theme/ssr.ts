import { THEME_NAMES, ThemeName } from './types';

/**
 * SSR-safe theme helpers used by `pages/_document.tsx`.
 *
 * Kept separate from `theme/index.ts` so the document module can resolve a
 * theme class without importing the full theme registry (and its Mantine /
 * React-component baggage) at SSR build time.
 */

export function isValidThemeName(name: string | undefined): name is ThemeName {
  return (
    name !== undefined && (THEME_NAMES as readonly string[]).includes(name)
  );
}

export function getThemeClass(
  envTheme: string | undefined = process.env.NEXT_PUBLIC_THEME,
): string {
  const themeName = isValidThemeName(envTheme) ? envTheme : 'hyperdx';
  return `theme-${themeName}`;
}
