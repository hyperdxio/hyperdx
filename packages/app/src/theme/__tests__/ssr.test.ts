import { getThemeClass, isValidThemeName } from '../ssr';
import { THEME_NAMES } from '../types';

describe('theme/ssr', () => {
  describe('isValidThemeName', () => {
    it.each(THEME_NAMES.map(n => [n] as const))(
      'should accept valid theme name "%s"',
      name => {
        expect(isValidThemeName(name)).toBe(true);
      },
    );

    it('should reject undefined', () => {
      expect(isValidThemeName(undefined)).toBe(false);
    });

    it('should reject an unknown string', () => {
      expect(isValidThemeName('not-a-real-theme')).toBe(false);
    });

    it('should reject the empty string', () => {
      expect(isValidThemeName('')).toBe(false);
    });
  });

  describe('getThemeClass', () => {
    it.each(THEME_NAMES.map(n => [n] as const))(
      'returns "theme-%s" for valid theme name',
      name => {
        expect(getThemeClass(name)).toBe(`theme-${name}`);
      },
    );

    it('returns "theme-hyperdx" when env var is undefined', () => {
      expect(getThemeClass(undefined)).toBe('theme-hyperdx');
    });

    it('returns "theme-hyperdx" for an invalid string', () => {
      expect(getThemeClass('not-a-real-theme')).toBe('theme-hyperdx');
    });

    it('returns "theme-hyperdx" for an attempted injection string', () => {
      expect(getThemeClass('"><script>alert(1)</script>')).toBe(
        'theme-hyperdx',
      );
    });
  });
});
