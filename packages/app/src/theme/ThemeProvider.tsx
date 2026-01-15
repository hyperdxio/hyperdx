import React, { createContext, useContext, useEffect, useMemo } from 'react';

import {
  clearDevTheme,
  getCurrentTheme,
  getCurrentThemeName,
  getTheme,
  setDevTheme,
  themes,
  toggleDevTheme,
} from './index';
import { ThemeConfig, ThemeName } from './types';

const IS_DEV =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_IS_LOCAL_MODE === 'true';

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
  themeName,
  children,
}: {
  themeName?: ThemeName;
  children: React.ReactNode;
}) {
  const theme = useMemo(() => {
    return themeName ? getTheme(themeName) : getCurrentTheme();
  }, [themeName]);

  const contextValue = useMemo(
    () => ({
      theme,
      themeName: theme.name,
      availableThemes: Object.keys(themes) as ThemeName[],
      setTheme: setDevTheme,
      toggleTheme: toggleDevTheme,
      clearThemeOverride: clearDevTheme,
      isDev: IS_DEV,
    }),
    [theme],
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
        toggleDevTheme();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dev mode: log theme info to console
  useEffect(() => {
    if (IS_DEV && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.info(
        `🎨 Theme: ${theme.displayName} (${theme.name})`,
        '\n   Toggle: Ctrl+Shift+T',
        '\n   Set via URL: ?theme=clickstack',
        '\n   Set via console: window.__setTheme("clickstack")',
      );

      // Expose helper functions to window for console access
      (window as any).__setTheme = setDevTheme;
      (window as any).__toggleTheme = toggleDevTheme;
      (window as any).__clearTheme = clearDevTheme;
      (window as any).__currentTheme = theme.name;
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    // Fallback for when used outside provider
    const theme = getCurrentTheme();
    return {
      theme,
      themeName: theme.name,
      availableThemes: Object.keys(themes) as ThemeName[],
      setTheme: setDevTheme,
      toggleTheme: toggleDevTheme,
      clearThemeOverride: clearDevTheme,
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
  return getCurrentThemeName();
}
