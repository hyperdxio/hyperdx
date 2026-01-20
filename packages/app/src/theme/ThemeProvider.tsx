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
  THEME_STORAGE_KEY,
  themes,
} from './index';
import { ThemeConfig, ThemeName } from './types';

const IS_DEV =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_IS_LOCAL_MODE === 'true';

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
  // The server cannot read localStorage/URL, so we must start with a deterministic value.
  //
  // HYDRATION NOTE: In dev mode, the useEffect below may update the theme after hydration
  // if localStorage/URL contains a different theme. This is intentional for dev testing
  // and will cause a brief flash. In production (IS_DEV=false), theme is stable and
  // matches server render. To avoid any flash in production, pass themeName prop explicitly.
  const [resolvedThemeName, setResolvedThemeName] = useState<ThemeName>(
    () => propsThemeName ?? DEFAULT_THEME,
  );

  // After hydration, read from localStorage/URL in dev mode only.
  // Uses consolidated getDevThemeName() from index.ts as single source of truth.
  // This effect only changes state in dev mode, so production has no hydration mismatch.
  useEffect(() => {
    // If theme is explicitly passed via props, use that (no dev override)
    if (propsThemeName) {
      setResolvedThemeName(propsThemeName);
      return;
    }

    // In dev mode only, allow URL/localStorage overrides for testing themes
    if (IS_DEV) {
      const devTheme = getDevThemeName();
      setResolvedThemeName(devTheme);
    }
  }, [propsThemeName]);

  const theme = useMemo(() => {
    return getTheme(resolvedThemeName);
  }, [resolvedThemeName]);

  // Theme control functions - update state without page reload
  const setTheme = useCallback((name: ThemeName) => {
    if (!IS_DEV) {
      console.warn('setTheme only works in development mode');
      return;
    }
    if (themes[name]) {
      localStorage.setItem(THEME_STORAGE_KEY, name);
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
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      return nextTheme;
    });
  }, []);

  const clearThemeOverride = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(THEME_STORAGE_KEY);
      setResolvedThemeName(propsThemeName ?? DEFAULT_THEME);
    }
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

  // Apply theme CSS class to document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      // Remove all theme classes
      Object.values(themes).forEach(t => {
        document.documentElement.classList.remove(t.cssClass);
      });
      // Add current theme class
      document.documentElement.classList.add(theme.cssClass);
    }
  }, [theme]);

  // Dev mode: keyboard shortcut to toggle theme (Ctrl+Shift+T)
  useEffect(() => {
    if (!IS_DEV || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTheme]);

  // Dev mode: expose theme API to window (namespaced to avoid global pollution)
  useEffect(() => {
    if (!IS_DEV || typeof window === 'undefined') return;

    // eslint-disable-next-line no-console
    console.info(
      `🎨 Theme: ${theme.displayName} (${theme.name})`,
      '\n   Toggle: Ctrl+Shift+T',
      '\n   Set via URL: ?theme=clickstack',
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
export function useLogo() {
  const { theme } = useAppTheme();
  return theme.Logo;
}

export function useIcon() {
  const { theme } = useAppTheme();
  return theme.Icon;
}

// Hook to get current theme name (useful for conditional rendering)
export function useThemeName(): ThemeName {
  const { themeName } = useAppTheme();
  return themeName;
}
