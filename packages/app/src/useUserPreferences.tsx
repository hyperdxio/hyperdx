import React from 'react';
import produce from 'immer';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type UserPreferences = {
  isUTC: boolean;
  timeFormat: '12h' | '24h';
  /** Color mode preference (light/dark). Separate from brand theme (hyperdx/clickstack). */
  colorMode: 'light' | 'dark';
  font: 'IBM Plex Mono' | 'Roboto Mono' | 'Inter' | 'Roboto';
  expandSidebarHeader?: boolean;
};

// Legacy type for migration
type LegacyUserPreferences = Omit<UserPreferences, 'colorMode'> & {
  theme?: 'light' | 'dark';
};

const STORAGE_KEY = 'hdx-user-preferences';
const DEFAULT_PREFERENCES: UserPreferences = {
  isUTC: false,
  timeFormat: '12h',
  colorMode: 'dark',
  font: 'IBM Plex Mono',
};

/**
 * Type guard to check if an object is a valid UserPreferences (already migrated).
 */
function isUserPreferences(obj: unknown): obj is UserPreferences {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  return (
    'colorMode' in obj &&
    typeof (obj as { colorMode: unknown }).colorMode === 'string' &&
    ((obj as { colorMode: string }).colorMode === 'light' ||
      (obj as { colorMode: string }).colorMode === 'dark')
  );
}

/**
 * Type guard to check if an object is a LegacyUserPreferences (needs migration).
 */
function isLegacyUserPreferences(obj: unknown): obj is LegacyUserPreferences {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  return (
    'theme' in obj &&
    !('colorMode' in obj) &&
    (typeof (obj as { theme?: unknown }).theme === 'string' ||
      (obj as { theme?: unknown }).theme === undefined)
  );
}

/**
 * Migrates old localStorage data from `theme` to `colorMode`.
 * This ensures existing users don't lose their light/dark mode preference.
 */
function migrateUserPreferences(stored: string | null): UserPreferences | null {
  if (!stored) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stored);

    // Check if migration is needed (old format has `theme` instead of `colorMode`)
    if (isLegacyUserPreferences(parsed)) {
      // Use destructuring to exclude `theme` property for better type safety
      const { theme, ...rest } = parsed;
      const migrated: UserPreferences = {
        ...DEFAULT_PREFERENCES,
        ...rest,
        colorMode: theme ?? DEFAULT_PREFERENCES.colorMode,
      };

      // Save migrated data back to localStorage
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        }
      } catch {
        // Ignore localStorage errors (private browsing, etc.)
      }

      return migrated;
    }

    // Already migrated or new format - validate it's a proper UserPreferences
    if (isUserPreferences(parsed)) {
      return parsed;
    }

    // Invalid format, return null to use defaults
    return null;
  } catch {
    // Invalid JSON, return null to use defaults
    return null;
  }
}

// Custom storage implementation with migration support
const storageWithMigration = {
  getItem: (key: string, initialValue: UserPreferences): UserPreferences => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const stored = localStorage.getItem(key);
      const migrated = migrateUserPreferences(stored);
      return migrated ?? initialValue;
    } catch {
      return initialValue;
    }
  },
  setItem: (key: string, value: UserPreferences): void => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      // Ignore localStorage errors (private browsing, etc.)
    }
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore localStorage errors (private browsing, etc.)
    }
  },
};

export const userPreferencesAtom = atomWithStorage<UserPreferences>(
  STORAGE_KEY,
  DEFAULT_PREFERENCES,
  storageWithMigration,
);

export const useUserPreferences = () => {
  const [userPreferences, setUserPreferences] = useAtom(userPreferencesAtom);

  const setUserPreference = React.useCallback(
    (preference: Partial<UserPreferences>) => {
      setUserPreferences(
        produce((draft: UserPreferences) => {
          return { ...draft, ...preference };
        }),
      );
    },
    [setUserPreferences],
  );

  return { userPreferences, setUserPreference };
};
