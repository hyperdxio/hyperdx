/**
 * Unit tests for theme utilities
 *
 * Tests cover:
 * - Theme registry and validation
 * - getTheme() function
 * - getDevThemeName() function (localStorage-based)
 * - Safe localStorage helpers
 * - THEME_STORAGE_KEY constant
 */

import {
  DEFAULT_THEME,
  getDevThemeName,
  getTheme,
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  THEME_NAMES,
  THEME_STORAGE_KEY,
  themes,
} from '../index';

describe('theme/index', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  describe('themes registry', () => {
    it('should contain hyperdx theme', () => {
      expect(themes.hyperdx).toBeDefined();
      expect(themes.hyperdx.name).toBe('hyperdx');
      expect(themes.hyperdx.displayName).toBe('HyperDX');
    });

    it('should contain clickstack theme', () => {
      expect(themes.clickstack).toBeDefined();
      expect(themes.clickstack.name).toBe('clickstack');
      expect(themes.clickstack.displayName).toBe('ClickStack');
    });

    it('should contain nord theme', () => {
      expect(themes.nord).toBeDefined();
      expect(themes.nord.name).toBe('nord');
      expect(themes.nord.displayName).toBe('Nord');
      expect(themes.nord.cssClass).toBe('theme-nord');
    });

    it('should contain catppuccin theme', () => {
      expect(themes.catppuccin).toBeDefined();
      expect(themes.catppuccin.name).toBe('catppuccin');
      expect(themes.catppuccin.displayName).toBe('Catppuccin');
      expect(themes.catppuccin.cssClass).toBe('theme-catppuccin');
    });

    it('should contain onedark theme', () => {
      expect(themes.onedark).toBeDefined();
      expect(themes.onedark.name).toBe('onedark');
      expect(themes.onedark.displayName).toBe('One Dark');
      expect(themes.onedark.cssClass).toBe('theme-onedark');
    });

    it('THEME_NAMES should match themes registry keys', () => {
      expect([...THEME_NAMES].sort()).toEqual(Object.keys(themes).sort());
    });

    it('each theme cssClass should be `theme-${name}`', () => {
      THEME_NAMES.forEach(name => {
        expect(themes[name].cssClass).toBe(`theme-${name}`);
      });
    });

    it('should have required properties for each theme', () => {
      Object.values(themes).forEach(theme => {
        expect(theme.name).toBeDefined();
        expect(theme.displayName).toBeDefined();
        expect(theme.mantineTheme).toBeDefined();
        expect(theme.Wordmark).toBeDefined();
        expect(theme.Logomark).toBeDefined();
        expect(theme.cssClass).toBeDefined();
        expect(theme.favicon).toBeDefined();
      });
    });

    it('should have valid favicon config for each theme', () => {
      Object.values(themes).forEach(theme => {
        expect(theme.favicon.svg).toBeDefined();
        expect(theme.favicon.png32).toBeDefined();
        expect(theme.favicon.png16).toBeDefined();
        expect(theme.favicon.appleTouchIcon).toBeDefined();
        expect(theme.favicon.themeColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it('should have unique cssClass for each theme', () => {
      const cssClasses = Object.values(themes).map(t => t.cssClass);
      const uniqueClasses = new Set(cssClasses);
      expect(uniqueClasses.size).toBe(cssClasses.length);
    });
  });

  describe('DEFAULT_THEME', () => {
    it('should be a valid theme name', () => {
      expect(THEME_NAMES).toContain(DEFAULT_THEME);
    });

    it('should exist in themes registry', () => {
      expect(themes[DEFAULT_THEME]).toBeDefined();
    });
  });

  describe('getTheme', () => {
    it('should return hyperdx theme for "hyperdx"', () => {
      const theme = getTheme('hyperdx');
      expect(theme.name).toBe('hyperdx');
    });

    it('should return clickstack theme for "clickstack"', () => {
      const theme = getTheme('clickstack');
      expect(theme.name).toBe('clickstack');
    });

    it('should return default theme when called without arguments', () => {
      const theme = getTheme();
      expect(theme).toBeDefined();
      expect(theme.name).toBe(DEFAULT_THEME);
    });

    it('should fallback to hyperdx for invalid theme name', () => {
      // @ts-expect-error Testing invalid input
      const theme = getTheme('invalid-theme');
      expect(theme.name).toBe('hyperdx');
    });

    it('should return theme with all required properties', () => {
      const theme = getTheme('hyperdx');
      expect(theme.name).toBeDefined();
      expect(theme.displayName).toBeDefined();
      expect(theme.mantineTheme).toBeDefined();
      expect(theme.Wordmark).toBeDefined();
      expect(theme.Logomark).toBeDefined();
      expect(theme.cssClass).toBeDefined();
      expect(theme.favicon).toBeDefined();
    });
  });

  describe('safeLocalStorageGet', () => {
    it('should return value from localStorage', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'clickstack');
      const result = safeLocalStorageGet(THEME_STORAGE_KEY);
      expect(result).toBe('clickstack');
    });

    it('should return undefined when localStorage item does not exist', () => {
      const result = safeLocalStorageGet('non-existent-key');
      expect(result).toBeUndefined();
    });

    it('should handle different value types stored as strings', () => {
      window.localStorage.setItem('test-key', 'some-value');
      const result = safeLocalStorageGet('test-key');
      expect(result).toBe('some-value');
    });
  });

  describe('safeLocalStorageSet', () => {
    it('should set value in localStorage', () => {
      safeLocalStorageSet(THEME_STORAGE_KEY, 'clickstack');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('clickstack');
    });

    it('should overwrite existing value', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'hyperdx');
      safeLocalStorageSet(THEME_STORAGE_KEY, 'clickstack');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('clickstack');
    });
  });

  describe('safeLocalStorageRemove', () => {
    it('should remove item from localStorage', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'clickstack');
      safeLocalStorageRemove(THEME_STORAGE_KEY);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('should not throw when removing non-existent key', () => {
      expect(() => safeLocalStorageRemove('non-existent-key')).not.toThrow();
    });
  });

  describe('getDevThemeName', () => {
    it('should return DEFAULT_THEME when no localStorage override exists', () => {
      // No localStorage override, should use default
      const result = getDevThemeName();
      expect(result).toBe(DEFAULT_THEME);
    });

    it('should use localStorage when set', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'clickstack');
      const result = getDevThemeName();
      expect(result).toBe('clickstack');
    });

    it('should ignore invalid localStorage value', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid-theme');
      const result = getDevThemeName();
      expect(result).toBe(DEFAULT_THEME);
    });
  });

  describe('THEME_STORAGE_KEY', () => {
    it('should be the expected key', () => {
      expect(THEME_STORAGE_KEY).toBe('hdx-dev-theme');
    });

    it('should be a non-empty string', () => {
      expect(typeof THEME_STORAGE_KEY).toBe('string');
      expect(THEME_STORAGE_KEY.length).toBeGreaterThan(0);
    });
  });

  describe('theme favicon paths', () => {
    it('should have consistent path structure for hyperdx', () => {
      const favicon = themes.hyperdx.favicon;
      expect(favicon.svg).toContain('/favicons/hyperdx/');
      expect(favicon.png32).toContain('/favicons/hyperdx/');
      expect(favicon.png16).toContain('/favicons/hyperdx/');
      expect(favicon.appleTouchIcon).toContain('/favicons/hyperdx/');
    });

    it('should have consistent path structure for clickstack', () => {
      const favicon = themes.clickstack.favicon;
      expect(favicon.svg).toContain('/favicons/clickstack/');
      expect(favicon.png32).toContain('/favicons/clickstack/');
      expect(favicon.png16).toContain('/favicons/clickstack/');
      expect(favicon.appleTouchIcon).toContain('/favicons/clickstack/');
    });
  });
});
