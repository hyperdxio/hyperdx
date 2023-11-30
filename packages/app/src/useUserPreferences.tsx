import React, { useContext, useState, useEffect } from 'react';
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
