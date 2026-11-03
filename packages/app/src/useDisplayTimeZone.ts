import { useMemo } from 'react';

import { resolveTimeZonePreference } from './timeZone';
import { useUserPreferences } from './useUserPreferences';

/**
 * IANA time zone that times are shown and typed in, or undefined for the
 * local zone.
 */
export function useDisplayTimeZone(): string | undefined {
  const {
    userPreferences: { timeZone },
  } = useUserPreferences();
  return useMemo(() => resolveTimeZonePreference(timeZone), [timeZone]);
}
