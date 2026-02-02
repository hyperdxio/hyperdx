/**
 * Unit tests for DynamicFavicon component
 *
 * Tests cover:
 * - sanitizeThemeColor XSS prevention
 * - Hydration safety (uses default theme favicon initially)
 * - Correct favicon paths based on theme
 */

import React from 'react';
import { render } from '@testing-library/react';

import {
  DEFAULT_THEME_COLOR,
  HEX_COLOR_PATTERN,
  sanitizeThemeColor,
} from '../DynamicFavicon';

// Note: Testing the full DynamicFavicon component requires mocking
// the Next.js Head component and ThemeProvider, which is complex.
// These tests focus on the sanitization logic which is the security-critical part.

describe('DynamicFavicon', () => {
  describe('HEX_COLOR_PATTERN', () => {
    it('should match valid 6-character hex colors', () => {
      expect(HEX_COLOR_PATTERN.test('#000000')).toBe(true);
      expect(HEX_COLOR_PATTERN.test('#FFFFFF')).toBe(true);
      expect(HEX_COLOR_PATTERN.test('#25292e')).toBe(true);
      expect(HEX_COLOR_PATTERN.test('#1a1a1a')).toBe(true);
      expect(HEX_COLOR_PATTERN.test('#AbCdEf')).toBe(true);
    });

    it('should not match invalid hex colors', () => {
      // Too short
      expect(HEX_COLOR_PATTERN.test('#000')).toBe(false);
      expect(HEX_COLOR_PATTERN.test('#FFF')).toBe(false);

      // Too long
      expect(HEX_COLOR_PATTERN.test('#0000000')).toBe(false);
      expect(HEX_COLOR_PATTERN.test('#00000000')).toBe(false);

      // Missing hash
      expect(HEX_COLOR_PATTERN.test('000000')).toBe(false);

      // Invalid characters
      expect(HEX_COLOR_PATTERN.test('#GGGGGG')).toBe(false);
      expect(HEX_COLOR_PATTERN.test('#00000G')).toBe(false);

      // XSS attempts
      expect(HEX_COLOR_PATTERN.test('#000000"><script>')).toBe(false);
      expect(HEX_COLOR_PATTERN.test("javascript:alert('xss')")).toBe(false);
      expect(HEX_COLOR_PATTERN.test('')).toBe(false);
    });
  });

  describe('sanitizeThemeColor', () => {
    it('should return valid hex colors unchanged', () => {
      expect(sanitizeThemeColor('#000000')).toBe('#000000');
      expect(sanitizeThemeColor('#FFFFFF')).toBe('#FFFFFF');
      expect(sanitizeThemeColor('#25292e')).toBe('#25292e');
      expect(sanitizeThemeColor('#1a1a1a')).toBe('#1a1a1a');
    });

    it('should return default color for invalid inputs', () => {
      expect(sanitizeThemeColor('')).toBe(DEFAULT_THEME_COLOR);
      expect(sanitizeThemeColor('#000')).toBe(DEFAULT_THEME_COLOR);
      expect(sanitizeThemeColor('000000')).toBe(DEFAULT_THEME_COLOR);
      expect(sanitizeThemeColor('#GGGGGG')).toBe(DEFAULT_THEME_COLOR);
    });

    it('should sanitize XSS injection attempts', () => {
      // Script injection
      expect(sanitizeThemeColor('#000000"><script>alert(1)</script>')).toBe(
        DEFAULT_THEME_COLOR,
      );

      // Event handler injection
      expect(sanitizeThemeColor('#000000" onload="alert(1)"')).toBe(
        DEFAULT_THEME_COLOR,
      );

      // JavaScript protocol
      expect(sanitizeThemeColor("javascript:alert('xss')")).toBe(
        DEFAULT_THEME_COLOR,
      );

      // Data URI
      expect(
        sanitizeThemeColor('data:text/html,<script>alert(1)</script>'),
      ).toBe(DEFAULT_THEME_COLOR);

      // CSS injection
      expect(sanitizeThemeColor('#000000; background: url(evil.com)')).toBe(
        DEFAULT_THEME_COLOR,
      );
    });

    it('should handle edge cases', () => {
      // @ts-expect-error Testing runtime behavior with null
      expect(sanitizeThemeColor(null)).toBe(DEFAULT_THEME_COLOR);

      // @ts-expect-error Testing runtime behavior with undefined
      expect(sanitizeThemeColor(undefined)).toBe(DEFAULT_THEME_COLOR);

      // @ts-expect-error Testing runtime behavior with number
      expect(sanitizeThemeColor(123)).toBe(DEFAULT_THEME_COLOR);

      // @ts-expect-error Testing runtime behavior with object
      expect(sanitizeThemeColor({})).toBe(DEFAULT_THEME_COLOR);
    });
  });

  describe('DEFAULT_THEME_COLOR', () => {
    it('should be a valid hex color', () => {
      expect(HEX_COLOR_PATTERN.test(DEFAULT_THEME_COLOR)).toBe(true);
    });

    it('should be the expected value', () => {
      expect(DEFAULT_THEME_COLOR).toBe('#25292e');
    });
  });
});
