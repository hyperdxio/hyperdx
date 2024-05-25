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

import React, { useContext, useEffect, useState } from 'react';

export const userPreferencesAtom = atomWithStorage<UserPreferences>(
  'hdx-user-preferences',
  {
    isUTC: false,
    timeFormat: '24h',
    theme: 'dark',
    font: 'IBM Plex Mono',
  },
);

export const useUserPreferencesV2 = () => {
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

import { useLocalStorage } from './utils';
export type TimeFormat = '12h' | '24h';

export const UserPreferences = React.createContext({
  isUTC: false,
  timeFormat: '24h' as TimeFormat,
  setTimeFormat: (timeFormat: TimeFormat) => {},
  setIsUTC: (isUTC: boolean) => {},
});

export const UserPreferencesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [storedTF, setTF] = useLocalStorage('timeFormat', '24h');
  const setTimeFormat = (timeFormat: TimeFormat) => {
    setState(state => ({ ...state, timeFormat }));
    setTF(timeFormat);
  };
  const initState = {
    isUTC: false,
    timeFormat: '24h' as TimeFormat,
    setTimeFormat,
    setIsUTC: (isUTC: boolean) => setState(state => ({ ...state, isUTC })),
  };

  const [state, setState] = useState(initState);

  // This only runs once in order to grab and set the initial timeFormat from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      let timeFormat = window.localStorage.getItem('timeFormat') as TimeFormat;
      if (timeFormat !== null) timeFormat = JSON.parse(timeFormat);

      if (timeFormat !== null) {
        setState(state => ({ ...state, timeFormat }));
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  return (
    <UserPreferences.Provider value={state}>
      {children}
    </UserPreferences.Provider>
  );
};

export default function useUserPreferences() {
  return useContext(UserPreferences);
}
