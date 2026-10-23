import { UTC_TIME_ZONE } from '@hyperdx/common-utils/dist/core/utils';

import { useUserPreferences } from './useUserPreferences';

/**
 * IANA time zone that times are shown and typed in, or undefined for the
 * local zone.
 */
export function useDisplayTimeZone(): string | undefined {
  const {
    userPreferences: { isUTC },
  } = useUserPreferences();
  return isUTC ? UTC_TIME_ZONE : undefined;
}
