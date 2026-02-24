/**
 * Unit tests for ThemeProvider
 *
 * Tests cover:
 * - Context provides correct theme data
 * - useAppTheme hook functionality
 * - useWordmark and useLogomark hooks
 * - Fallback behavior outside provider
 * - Theme CSS class application
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react';

import { DEFAULT_THEME, themes } from '../index';
import {
  AppThemeProvider,
  useAppTheme,
  useLogomark,
  useThemeName,
  useWordmark,
} from '../ThemeProvider';

// Mock localStorage
let localStorageMock: jest.Mocked<Storage>;

beforeEach(() => {
  localStorageMock = {
    getItem: jest.fn().mockReturnValue(null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    key: jest.fn(),
    length: 0,
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });

  // Reset document classList
  document.documentElement.className = '';
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('ThemeProvider', () => {
  describe('AppThemeProvider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppThemeProvider>{children}</AppThemeProvider>
    );

    it('should provide default theme when no props passed', () => {
      const { result } = renderHook(() => useAppTheme(), { wrapper });

      expect(result.current.theme).toBeDefined();
      expect(result.current.themeName).toBe(DEFAULT_THEME);
    });

    it('should use themeName prop when provided', () => {
      const customWrapper = ({ children }: { children: React.ReactNode }) => (
        <AppThemeProvider themeName="clickstack">{children}</AppThemeProvider>
      );

      const { result } = renderHook(() => useAppTheme(), {
        wrapper: customWrapper,
      });

      expect(result.current.themeName).toBe('clickstack');
      expect(result.current.theme.name).toBe('clickstack');
    });

    it('should provide list of available themes', () => {
      const { result } = renderHook(() => useAppTheme(), { wrapper });

      expect(result.current.availableThemes).toEqual(
        expect.arrayContaining(['hyperdx', 'clickstack']),
      );
    });

    it('should provide isDev flag', () => {
      const { result } = renderHook(() => useAppTheme(), { wrapper });

      expect(typeof result.current.isDev).toBe('boolean');
    });

    it('should apply theme CSS class to document', () => {
      renderHook(() => useAppTheme(), { wrapper });

      // Check that exactly one theme class is applied
      const appliedThemeClasses = Object.values(themes)
        .map(t => t.cssClass)
        .filter(cls => document.documentElement.classList.contains(cls));

      expect(appliedThemeClasses.length).toBe(1);
    });
  });

  describe('useAppTheme outside provider', () => {
    it('should return fallback values without crashing', () => {
      // Mock console.warn to avoid noise
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useAppTheme());

      expect(result.current.theme).toBeDefined();
      expect(result.current.themeName).toBe(DEFAULT_THEME);
      expect(result.current.availableThemes).toBeDefined();

      // Calling setTheme outside provider should warn
      result.current.setTheme('clickstack');
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('useWordmark', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppThemeProvider>{children}</AppThemeProvider>
    );

    it('should return a component', () => {
      const { result } = renderHook(() => useWordmark(), { wrapper });

      expect(result.current).toBeDefined();
      expect(typeof result.current).toBe('object');
    });
  });

  describe('useLogomark', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppThemeProvider>{children}</AppThemeProvider>
    );

    it('should return a component', () => {
      const { result } = renderHook(() => useLogomark(), { wrapper });

      expect(result.current).toBeDefined();
      expect(typeof result.current).toBe('object');
    });
  });

  describe('useThemeName', () => {
    it('should return current theme name', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AppThemeProvider themeName="clickstack">{children}</AppThemeProvider>
      );

      const { result } = renderHook(() => useThemeName(), { wrapper });

      expect(result.current).toBe('clickstack');
    });
  });

  describe('theme switching (dev mode)', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppThemeProvider>{children}</AppThemeProvider>
    );

    it('should have setTheme function', () => {
      const { result } = renderHook(() => useAppTheme(), { wrapper });

      expect(typeof result.current.setTheme).toBe('function');
    });

    it('should have toggleTheme function', () => {
      const { result } = renderHook(() => useAppTheme(), { wrapper });

      expect(typeof result.current.toggleTheme).toBe('function');
    });

    it('should have clearThemeOverride function', () => {
      const { result } = renderHook(() => useAppTheme(), { wrapper });

      expect(typeof result.current.clearThemeOverride).toBe('function');
    });
  });

  describe('hydration safety', () => {
    it('should start with deterministic theme for SSR consistency', () => {
      // Initial render should use DEFAULT_THEME or props, not localStorage
      // This ensures server and client render the same initially
      const { result } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }) => (
          <AppThemeProvider>{children}</AppThemeProvider>
        ),
      });

      // Should be deterministic (props or DEFAULT_THEME)
      expect(result.current.themeName).toBe(DEFAULT_THEME);
    });

    it('should use props theme for consistent hydration', () => {
      const { result } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }) => (
          <AppThemeProvider themeName="clickstack">{children}</AppThemeProvider>
        ),
      });

      // Props should take precedence for hydration consistency
      expect(result.current.themeName).toBe('clickstack');
    });
  });
});
