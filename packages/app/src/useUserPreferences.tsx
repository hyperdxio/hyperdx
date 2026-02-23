import React from 'react';
import produce from 'immer';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type ColorModePreference = 'light' | 'dark' | 'system';

export type UserPreferences = {
  isUTC: boolean;
  timeFormat: '12h' | '24h';
  /** Color mode preference (light/dark/system). Separate from brand theme (hyperdx/clickstack). */
  colorMode: ColorModePreference;
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
  colorMode: 'system',
  font: 'IBM Plex Mono',
};

// Cache migration result in memory to avoid repeated localStorage writes
// This cache stores the migrated result for a given stored value
let migrationCache: {
  storedValue: string;
  result: UserPreferences | null;
} | null = null;

/**
 * Type guard to check if an object is a valid UserPreferences (already migrated).
 */
function isUserPreferences(obj: unknown): obj is UserPreferences {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const mode = (obj as { colorMode: unknown }).colorMode;
  return (
    'colorMode' in obj &&
    typeof mode === 'string' &&
    (mode === 'light' || mode === 'dark' || mode === 'system')
  );
}

/**
 * Type guard to check if an object is a LegacyUserPreferences (needs migration).
 */
function isLegacyUserPreferences(obj: unknown): obj is LegacyUserPreferences {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const hasTheme = 'theme' in obj;
  const hasColorMode = 'colorMode' in obj;

  if (!hasTheme || hasColorMode) {
    return false;
  }

  const theme = (obj as { theme?: unknown }).theme;

  // Validate theme is either undefined or a valid color mode value
  return (
    theme === undefined ||
    (typeof theme === 'string' && (theme === 'light' || theme === 'dark'))
  );
}

/**
 * Migrates old localStorage data from `theme` to `colorMode`.
 * This ensures existing users don't lose their light/dark mode preference.
 *
 * Uses an in-memory cache to avoid repeated localStorage writes on every read.
 *
 * @internal Exported for testing only
 */
export function migrateUserPreferences(
  stored: string | null,
): UserPreferences | null {
  if (!stored) {
    // Clear cache if storage is empty
    migrationCache = null;
    return null;
  }

  // Check cache first - if we've already processed this exact value, return cached result
  if (migrationCache && migrationCache.storedValue === stored) {
    return migrationCache.result;
  }

  try {
    const parsed: unknown = JSON.parse(stored);

    // Check if migration is needed (old format has `theme` instead of `colorMode`)
    if (isLegacyUserPreferences(parsed)) {
      // Use destructuring to exclude `theme` property for better type safety
      const { theme, ...rest } = parsed;
      // Ensure theme is valid before using it (legacy only had light/dark)
      const validTheme: 'light' | 'dark' =
        theme === 'light' || theme === 'dark' ? theme : 'dark';
      const migrated: UserPreferences = {
        ...DEFAULT_PREFERENCES,
        ...rest,
        colorMode: validTheme,
      };

      // Only write to localStorage if the migrated data differs from what's stored
      // This prevents unnecessary writes on every render and avoids race conditions
      try {
        if (typeof window !== 'undefined') {
          const migratedJson = JSON.stringify(migrated);
          // Compare with current stored value to avoid unnecessary write
          const currentStored = localStorage.getItem(STORAGE_KEY);
          if (currentStored !== migratedJson) {
            localStorage.setItem(STORAGE_KEY, migratedJson);
          }
        }
      } catch {
        // Ignore localStorage errors (private browsing, etc.)
      }

      // Cache the result to avoid re-processing on subsequent calls
      migrationCache = {
        storedValue: stored,
        result: migrated,
      };

      return migrated;
    }

    // Already migrated or new format - validate it's a proper UserPreferences
    if (isUserPreferences(parsed)) {
      // Cache the result to avoid re-processing on subsequent calls
      migrationCache = {
        storedValue: stored,
        result: parsed,
      };
      return parsed;
    }

    // Invalid format, return null to use defaults
    migrationCache = {
      storedValue: stored,
      result: null,
    };
    return null;
  } catch {
    // Invalid JSON, return null to use defaults
    migrationCache = null;
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

/**
 * Inline script that runs before React to set data-mantine-color-scheme from
 * user preference (light/dark/system). Prevents flash when preference is "system".
 */
export function SystemColorSchemeScript() {
  const scriptContent = `(function(){var k='${STORAGE_KEY}';try{var r=localStorage.getItem(k);var p=r?JSON.parse(r):null;var m=p&&p.colorMode;var s='dark';if(m==='light'||m==='dark')s=m;else if(typeof window.matchMedia!=='undefined'&&window.matchMedia('(prefers-color-scheme: dark)').matches)s='dark';else s='light';document.documentElement.setAttribute('data-mantine-color-scheme',s);}catch(e){}})();`;
  return (
    <script
      dangerouslySetInnerHTML={{ __html: scriptContent }}
      suppressHydrationWarning
    />
  );
}

/**
 * Resolves color mode preference to an actual scheme for Mantine.
 * When preference is 'system', follows prefers-color-scheme and reacts to changes.
 */
export function useResolvedColorScheme(): 'light' | 'dark' {
  const { userPreferences } = useUserPreferences();
  const { colorMode } = userPreferences;

  const [systemScheme, setSystemScheme] = React.useState<'light' | 'dark'>(
    () => {
      if (typeof window === 'undefined') return 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    },
  );

  React.useEffect(() => {
    if (colorMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemScheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [colorMode]);

  if (colorMode === 'light' || colorMode === 'dark') return colorMode;
  return systemScheme;
}
