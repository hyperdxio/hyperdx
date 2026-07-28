import { useCallback } from 'react';

import type { Locale } from '@/i18n/config';
import { useUserPreferences } from '@/useUserPreferences';

export function useLocale() {
  const { userPreferences, setUserPreference } = useUserPreferences();

  const setLocale = useCallback(
    (locale: Locale) => {
      setUserPreference({ locale });
    },
    [setUserPreference],
  );

  return { locale: userPreferences.locale, setLocale };
}
