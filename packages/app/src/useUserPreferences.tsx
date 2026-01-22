import React from 'react';
import produce from 'immer';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type UserPreferences = {
  isUTC: boolean;
  timeFormat: '12h' | '24h';
  theme: 'light' | 'dark';
  font: 'IBM Plex Mono' | 'Roboto Mono' | 'Inter' | 'Roboto';
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
