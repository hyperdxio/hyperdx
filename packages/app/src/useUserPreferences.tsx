import React, { useContext, useState } from 'react';

export type TimeFormat = '12h' | '24h';

export const UserPreferences = React.createContext({
  isUTC: false,
  timeFormat: '12h' as TimeFormat,
  setTimeFormat: (timeFormat: TimeFormat) => {},
  setIsUTC: (isUTC: boolean) => {},
});

export const UserPreferencesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const initState = {
    isUTC: false,
    timeFormat: '12h' as TimeFormat,
    setTimeFormat: (timeFormat: TimeFormat) =>
      setState(state => ({ ...state, timeFormat })),
    setIsUTC: (isUTC: boolean) => setState(state => ({ ...state, isUTC })),
  };

  const [state, setState] = useState(initState);

  return (
    <UserPreferences.Provider value={state}>
      {children}
    </UserPreferences.Provider>
  );
};

export default function useUserPreferences() {
  return useContext(UserPreferences);
}
