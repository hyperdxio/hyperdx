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
 * Migrates old localStorage data from `theme` to `colorMode`.
 * This ensures existing users don't lose their light/dark mode preference.
 */
function migrateUserPreferences(stored: string | null): UserPreferences | null {
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as
      | LegacyUserPreferences
      | UserPreferences;

    // Check if migration is needed (old format has `theme` instead of `colorMode`)
    if ('theme' in parsed && !('colorMode' in parsed)) {
      const migrated: UserPreferences = {
        ...DEFAULT_PREFERENCES,
        ...parsed,
        colorMode: parsed.theme ?? DEFAULT_PREFERENCES.colorMode,
      };
      // Remove old `theme` property
      delete (migrated as any).theme;

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

    // Already migrated or new format
    return parsed as UserPreferences;
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
