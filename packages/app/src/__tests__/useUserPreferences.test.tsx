/**
 * Unit tests for useUserPreferences migration function
 *
 * Tests cover:
 * - Legacy format migration (theme → colorMode)
 * - Partial/corrupted localStorage data handling
 * - Migration idempotency (safe to run multiple times)
 */

import type { UserPreferences } from '../useUserPreferences';
import { migrateUserPreferences } from '../useUserPreferences';

const STORAGE_KEY = 'hdx-user-preferences';

describe('migrateUserPreferences', () => {
  // Store original localStorage
  const originalLocalStorage = window.localStorage;
  let localStorageMock: jest.Mocked<Storage>;

  beforeEach(() => {
    // Create localStorage mock
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
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Restore original localStorage
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  describe('Legacy format migration (theme → colorMode)', () => {
    it('should migrate theme="dark" to colorMode="dark"', () => {
      const legacyData = JSON.stringify({
        isUTC: false,
        timeFormat: '12h',
        theme: 'dark',
        font: 'IBM Plex Mono',
      });

      const result = migrateUserPreferences(legacyData);

      expect(result).toEqual({
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'dark',
        font: 'IBM Plex Mono',
      });
      // Verify theme property was removed during migration
      expect('theme' in (result || {})).toBe(false);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        JSON.stringify(result),
      );
    });

    it('should migrate theme="light" to colorMode="light"', () => {
      const legacyData = JSON.stringify({
        isUTC: true,
        timeFormat: '24h',
        theme: 'light',
        font: 'Inter',
      });

      const result = migrateUserPreferences(legacyData);

      expect(result).toEqual({
        isUTC: true,
        timeFormat: '24h',
        colorMode: 'light',
        font: 'Inter',
      });
      // Verify theme property was removed during migration
      expect('theme' in (result || {})).toBe(false);
    });

    it('should use default colorMode when theme property is missing', () => {
      // JSON.stringify omits undefined properties, so we simulate legacy data
      // without theme property - this should not match legacy format
      const legacyDataWithoutTheme = JSON.stringify({
        isUTC: false,
        timeFormat: '12h',
        font: 'IBM Plex Mono',
        // theme property missing
      });

      // Should return null since it doesn't match legacy format
      const result = migrateUserPreferences(legacyDataWithoutTheme);
      expect(result).toBeNull();
    });

    it('should return null when theme is explicitly null (invalid value)', () => {
      // Simulate legacy data where theme was explicitly set to null
      // null is not a valid theme value, so it won't match legacy format
      const legacyData = JSON.stringify({
        isUTC: false,
        timeFormat: '12h',
        theme: null,
        font: 'IBM Plex Mono',
      });

      // null theme doesn't match legacy format (type guard requires string or undefined)
      // and it's not a valid UserPreferences (no colorMode)
      // So it should return null to use defaults
      const result = migrateUserPreferences(legacyData);
      expect(result).toBeNull();
    });

    it('should preserve all other user preferences during migration', () => {
      const legacyData = JSON.stringify({
        isUTC: true,
        timeFormat: '24h',
        theme: 'light',
        font: 'Roboto Mono',
        expandSidebarHeader: true,
      });

      const result = migrateUserPreferences(legacyData);

      expect(result).toEqual({
        isUTC: true,
        timeFormat: '24h',
        colorMode: 'light',
        font: 'Roboto Mono',
        expandSidebarHeader: true,
      });
    });

    it('should merge with default preferences for missing fields', () => {
      const legacyData = JSON.stringify({
        theme: 'dark',
        // Missing other fields
      });

      const result = migrateUserPreferences(legacyData);

      expect(result).toEqual({
        isUTC: false, // From DEFAULT_PREFERENCES
        timeFormat: '12h', // From DEFAULT_PREFERENCES
        colorMode: 'dark', // Migrated from theme
        font: 'IBM Plex Mono', // From DEFAULT_PREFERENCES
      });
    });
  });

  describe('Partial/corrupted localStorage data', () => {
    it('should return null for null input', () => {
      const result = migrateUserPreferences(null);
      expect(result).toBeNull();
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should return null for invalid JSON', () => {
      const invalidJson = '{ invalid json }';
      const result = migrateUserPreferences(invalidJson);
      expect(result).toBeNull();
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should return null for empty string', () => {
      const result = migrateUserPreferences('');
      expect(result).toBeNull();
    });

    it('should return null for non-object JSON', () => {
      const result = migrateUserPreferences('"string"');
      expect(result).toBeNull();
    });

    it('should return null for array JSON', () => {
      const result = migrateUserPreferences('[]');
      expect(result).toBeNull();
    });

    it('should return null for object without theme or colorMode', () => {
      const invalidData = JSON.stringify({
        isUTC: false,
        timeFormat: '12h',
        // No theme or colorMode
      });

      const result = migrateUserPreferences(invalidData);
      expect(result).toBeNull();
    });

    it('should return null for object with invalid colorMode value', () => {
      const invalidData = JSON.stringify({
        colorMode: 'invalid-value',
        isUTC: false,
      });

      const result = migrateUserPreferences(invalidData);
      expect(result).toBeNull();
    });

    it('should handle partial legacy data gracefully', () => {
      const partialData = JSON.stringify({
        theme: 'light',
        // Missing other required fields
      });

      const result = migrateUserPreferences(partialData);

      expect(result).toEqual({
        isUTC: false, // From DEFAULT_PREFERENCES
        timeFormat: '12h', // From DEFAULT_PREFERENCES
        colorMode: 'light', // Migrated from theme
        font: 'IBM Plex Mono', // From DEFAULT_PREFERENCES
      });
    });

    it('should handle extra unknown properties in legacy data', () => {
      const legacyData = JSON.stringify({
        theme: 'dark',
        isUTC: false,
        timeFormat: '12h',
        font: 'IBM Plex Mono',
        unknownProperty: 'should be preserved',
        anotherUnknown: 123,
      });

      const result = migrateUserPreferences(legacyData);

      expect(result).toEqual({
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'dark',
        font: 'IBM Plex Mono',
        unknownProperty: 'should be preserved',
        anotherUnknown: 123,
      });
    });
  });

  describe('Migration idempotency', () => {
    it('should return already migrated data unchanged', () => {
      const migratedData: UserPreferences = {
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'dark',
        font: 'IBM Plex Mono',
      };

      const result = migrateUserPreferences(JSON.stringify(migratedData));

      expect(result).toEqual(migratedData);
      // Should not call setItem since data is already migrated
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should accept colorMode "system" as valid', () => {
      const dataWithSystem: UserPreferences = {
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'system',
        font: 'IBM Plex Mono',
      };

      const result = migrateUserPreferences(JSON.stringify(dataWithSystem));

      expect(result).toEqual(dataWithSystem);
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should handle data with both theme and colorMode (edge case)', () => {
      // If somehow both exist, prefer colorMode (already migrated)
      const mixedData = JSON.stringify({
        theme: 'light',
        colorMode: 'dark',
        isUTC: false,
        timeFormat: '12h',
        font: 'IBM Plex Mono',
      });

      const result = migrateUserPreferences(mixedData);

      // Should use colorMode (already migrated, ignore theme)
      expect(result?.colorMode).toBe('dark');
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times on same legacy data', () => {
      const legacyData = JSON.stringify({
        theme: 'light',
        isUTC: true,
        timeFormat: '24h',
        font: 'Inter',
      });

      // First migration
      const firstResult = migrateUserPreferences(legacyData);
      expect(firstResult?.colorMode).toBe('light');
      // Verify theme property was removed during migration
      expect('theme' in (firstResult || {})).toBe(false);

      // Simulate that localStorage now has migrated data
      localStorageMock.getItem.mockReturnValue(JSON.stringify(firstResult));

      // Second migration (should be idempotent)
      const secondResult = migrateUserPreferences(JSON.stringify(firstResult));
      expect(secondResult).toEqual(firstResult);
      // Should not call setItem again since already migrated
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('localStorage error handling', () => {
    it('should handle localStorage.setItem errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('localStorage quota exceeded');
      });

      const legacyData = JSON.stringify({
        theme: 'dark',
        isUTC: false,
        timeFormat: '12h',
        font: 'IBM Plex Mono',
      });

      // Should not throw, should return migrated data even if save fails
      const result = migrateUserPreferences(legacyData);
      expect(result).toEqual({
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'dark',
        font: 'IBM Plex Mono',
      });
    });
  });

  describe('SSR safety', () => {
    it('should return migrated data even if localStorage is unavailable', () => {
      // Simulate localStorage being unavailable (private browsing, etc.)
      // The function should still return migrated data even if it can't save
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const legacyData = JSON.stringify({
        theme: 'dark',
        isUTC: false,
        timeFormat: '12h',
        font: 'IBM Plex Mono',
      });

      // Should not throw - should return migrated data
      const result = migrateUserPreferences(legacyData);
      expect(result).toEqual({
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'dark',
        font: 'IBM Plex Mono',
      });
    });
  });
});
