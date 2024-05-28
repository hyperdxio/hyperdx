import React from 'react';
import produce from 'immer';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type UserPreferences = {
  isUTC: boolean;
  timeFormat: '12h' | '24h';
  theme: 'light' | 'dark';
  font: 'IBM Plex Mono' | 'Inter';
  backgroundUrl?: string;
  backgroundBlur?: number;
  backgroundOpacity?: number;
  backgroundBlendMode?: string;
};

export const userPreferencesAtom = atomWithStorage<UserPreferences>(
  'hdx-user-preferences',
  {
    isUTC: false,
    timeFormat: '24h',
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

export const useBackground = (prefs: UserPreferences) => {
  if (!prefs.backgroundUrl) {
    return null;
  }

  const blurOffset = -1.5 * (prefs.backgroundBlur || 0) + 'px';

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
        mixBlendMode: (prefs.backgroundBlendMode as any) ?? 'screen',
      }}
    />
  );
};
