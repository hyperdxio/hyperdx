import React from 'react';
import produce from 'immer';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type UserPreferences = {
  isUTC: boolean;
  timeFormat: '12h' | '24h';
  theme: 'light' | 'dark';
  font: 'IBM Plex Mono' | 'Roboto Mono' | 'Inter' | 'Roboto';
  backgroundEnabled?: boolean;
  backgroundUrl?: string;
  backgroundBlur?: number;
  backgroundOpacity?: number;
  backgroundBlendMode?: string;
  expandSidebarHeader?: boolean;
};

export const userPreferencesAtom = atomWithStorage<UserPreferences>(
  'hdx-user-preferences',
  {
    isUTC: false,
    timeFormat: '12h',
    theme: 'dark',
    font: 'IBM Plex Mono',
  },
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

// Validate that a URL is safe to use (prevent XSS via javascript: URLs)
function isSafeBackgroundUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    // Only allow http, https, and data URLs (for base64 images)
    return ['http:', 'https:', 'data:'].includes(parsed.protocol);
  } catch {
    // Invalid URL - could be a relative path, which is safe
    return !url.toLowerCase().startsWith('javascript:');
  }
}

// Valid CSS mix-blend-mode values
const VALID_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

type BlendMode = (typeof VALID_BLEND_MODES)[number];

function isValidBlendMode(mode: string | undefined): mode is BlendMode {
  return VALID_BLEND_MODES.includes(mode as BlendMode);
}

export const useBackground = (prefs: UserPreferences) => {
  if (!prefs.backgroundEnabled || !prefs.backgroundUrl) {
    return null;
  }

  // Validate URL to prevent XSS attacks (e.g., javascript: URLs)
  if (!isSafeBackgroundUrl(prefs.backgroundUrl)) {
    console.warn('useBackground: Invalid or unsafe background URL');
    return null;
  }

  const blurOffset = -1.5 * (prefs.backgroundBlur || 0) + 'px';
  const blendMode: BlendMode = isValidBlendMode(prefs.backgroundBlendMode)
    ? prefs.backgroundBlendMode
    : 'screen';

  return (
    <div
      className="hdx-background-image"
      style={{
        backgroundImage: `url(${prefs.backgroundUrl})`,
        opacity: prefs.backgroundOpacity ?? 0.1,
        top: blurOffset,
        left: blurOffset,
        right: blurOffset,
        bottom: blurOffset,
        filter: `blur(${prefs.backgroundBlur}px)`,
        mixBlendMode: blendMode,
      }}
    />
  );
};
