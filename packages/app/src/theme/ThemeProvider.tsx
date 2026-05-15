import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DEFAULT_THEME,
  getDevThemeName,
  getTheme,
  IS_DEV,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  THEME_STORAGE_KEY,
  themes,
} from './index';
import { ThemeConfig, ThemeName } from './types';

// Type declaration for window namespace (avoids conflicts)
declare global {
  interface Window {
    __HDX_THEME?: {
      current: ThemeName;
      set: (name: ThemeName) => void;
      toggle: () => void;
      clear: () => void;
    };
  }
}

interface ThemeContextValue {
  theme: ThemeConfig;
  themeName: ThemeName;
  availableThemes: ThemeName[];
  // Dev-only functions
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
  clearThemeOverride: () => void;
  isDev: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({
  themeName: propsThemeName,
  children,
}: {
  themeName?: ThemeName;
  children: React.ReactNode;
}) {
  // SSR/initial render: Always use props or DEFAULT_THEME for hydration consistency.
  // The server cannot read localStorage, so we must start with a deterministic value.
  //
  // HYDRATION NOTE: In dev mode, the useEffect that syncs localStorage may update
  // the theme after hydration if localStorage contains a different theme. This is
  // intentional for dev testing and will cause a brief flash. In production
  // (IS_DEV=false), theme is stable and matches server render. To avoid any flash
  // in production, pass themeName prop explicitly.
  const [resolvedThemeName, setResolvedThemeName] = useState<ThemeName>(
    () => propsThemeName ?? DEFAULT_THEME,
  );

  // After hydration, read from localStorage in dev mode only.
  // Uses consolidated getDevThemeName() from index.ts as single source of truth.
  // This effect only changes state in dev mode, so production has no hydration mismatch.
  useEffect(() => {
    // If theme is explicitly passed via props, use that (no dev override)
    if (propsThemeName) {
      setResolvedThemeName(propsThemeName);
      return;
    }

    // In dev mode only, allow localStorage override for testing themes
    if (IS_DEV) {
      const devTheme = getDevThemeName();
      setResolvedThemeName(devTheme);
    }
  }, [propsThemeName]);

  const theme = useMemo(() => {
    return getTheme(resolvedThemeName);
  }, [resolvedThemeName]);

  // Theme control functions - DEV MODE ONLY
  // Brand theme is deployment-configured in production (via NEXT_PUBLIC_THEME).
  // These functions are intentionally disabled in production - users should not
  // be able to switch brand themes; each deployment is branded for one product.
  const setTheme = useCallback((name: ThemeName) => {
    if (!IS_DEV) {
      console.warn(
        'setTheme only works in development mode. Brand theme is deployment-configured in production.',
      );
      return;
    }
    if (themes[name]) {
      safeLocalStorageSet(THEME_STORAGE_KEY, name);
      setResolvedThemeName(name);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    if (!IS_DEV) return;
    const themeNames = Object.keys(themes) as ThemeName[];
    setResolvedThemeName(current => {
      const currentIndex = themeNames.indexOf(current);
      const nextIndex = (currentIndex + 1) % themeNames.length;
      const nextTheme = themeNames[nextIndex];
      safeLocalStorageSet(THEME_STORAGE_KEY, nextTheme);
      return nextTheme;
    });
  }, []);

  const clearThemeOverride = useCallback(() => {
    safeLocalStorageRemove(THEME_STORAGE_KEY);
    setResolvedThemeName(propsThemeName ?? DEFAULT_THEME);
  }, [propsThemeName]);

  const contextValue = useMemo(
    () => ({
      theme,
      themeName: theme.name,
      availableThemes: Object.keys(themes) as ThemeName[],
      setTheme,
      toggleTheme,
      clearThemeOverride,
      isDev: IS_DEV,
    }),
    [theme, setTheme, toggleTheme, clearThemeOverride],
  );

  // Apply theme CSS class to <html> synchronously during render so descendants
  // that read CSS variables in the same commit (e.g. chart formatting via
  // getComputedStyle) see the correct theme. useEffect runs too late — after
  // children have already rendered with the previous class still on the document.
  if (typeof document !== 'undefined') {
    const html = document.documentElement;
    const nextClass = theme.cssClass;
    for (const t of Object.values(themes)) {
      if (t.cssClass !== nextClass) {
        html.classList.remove(t.cssClass);
      }
    }
    if (!html.classList.contains(nextClass)) {
      html.classList.add(nextClass);
    }
  }

  // Dev mode: expose theme API to window (namespaced to avoid global pollution)
  useEffect(() => {
    if (!IS_DEV || typeof window === 'undefined') return;

    // eslint-disable-next-line no-console
    console.info(
      `🎨 Theme: ${theme.displayName} (${theme.name})`,
      '\n   Set via console: window.__HDX_THEME.set("clickstack")',
    );

    // Expose namespaced helper object to window for console access
    window.__HDX_THEME = {
      current: theme.name,
      set: setTheme,
      toggle: toggleTheme,
      clear: clearThemeOverride,
    };

    // Cleanup on unmount
    return () => {
      delete window.__HDX_THEME;
    };
  }, [theme, setTheme, toggleTheme, clearThemeOverride]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    // Fallback for when used outside provider - always use default to avoid hydration issues
    const theme = getTheme(DEFAULT_THEME);
    return {
      theme,
      themeName: theme.name,
      availableThemes: Object.keys(themes) as ThemeName[],
      // No-op functions when outside provider context
      setTheme: () => {
        console.warn(
          'useAppTheme: setTheme called outside of AppThemeProvider',
        );
      },
      toggleTheme: () => {
        console.warn(
          'useAppTheme: toggleTheme called outside of AppThemeProvider',
        );
      },
      clearThemeOverride: () => {
        console.warn(
          'useAppTheme: clearThemeOverride called outside of AppThemeProvider',
        );
      },
      isDev: IS_DEV,
    };
  }
  return context;
}

// Convenience hooks
// NOTE: These hooks return JSX elements, not component references, to avoid
// creating components during render (which would violate react-hooks/static-components)
export function useWordmark() {
  const { theme } = useAppTheme();
  const WordmarkComponent = theme.Wordmark;
  return useMemo(() => <WordmarkComponent />, [WordmarkComponent]);
}

export function useLogomark(props?: { size?: number }) {
  const { theme } = useAppTheme();
  const LogomarkComponent = theme.Logomark;
  return useMemo(
    () => <LogomarkComponent {...props} />,
    [LogomarkComponent, props],
  );
}

// Hook to get current theme name (useful for conditional rendering)
export function useThemeName(): ThemeName {
  const { themeName } = useAppTheme();
  return themeName;
}

/** Hook to get the current theme's display name for UI copy (e.g. "HyperDX" or "ClickStack"). */
export function useBrandDisplayName(): string {
  const { theme } = useAppTheme();
  return theme.displayName;
}
