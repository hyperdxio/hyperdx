import { useMemo } from 'react';

import { resolveTimeZonePreference } from './timeZone';
import { useTimeZoneOverride } from './timeZoneOverride';
import { useUserPreferences } from './useUserPreferences';

/**
 * IANA time zone that times are shown and typed in, or undefined for the
 * local zone. The page's override wins over the user's setting.
 */
export function useDisplayTimeZone(): string | undefined {
  const {
    userPreferences: { timeZone },
  } = useUserPreferences();

  const override = useTimeZoneOverride()?.timeZone;

  return useMemo(
    () => resolveTimeZonePreference(override ?? timeZone),
    [override, timeZone],
  );
}
