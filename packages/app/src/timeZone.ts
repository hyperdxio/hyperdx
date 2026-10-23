import { UTC_TIME_ZONE } from '@hyperdx/common-utils/dist/core/utils';

/** Time zone setting value that follows the browser's zone. */
export const LOCAL_TIME_ZONE = 'local';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone a setting refers to, or undefined for the local zone. Zones
 * the browser doesn't recognise fall back to local.
 */
export function resolveTimeZonePreference(
  preference: string,
): string | undefined {
  return preference !== LOCAL_TIME_ZONE && isValidTimeZone(preference)
    ? preference
    : undefined;
}

/** The setting that `isUTC`, the switch that predates it, maps to. */
export function timeZonePreferenceFromIsUTC(isUTC: unknown) {
  return isUTC === true ? UTC_TIME_ZONE : LOCAL_TIME_ZONE;
}

/**
 * Short name of `timeZone` at `date`, e.g. "UTC", "PDT" or "GMT+9". en-US is
 * used because it has abbreviations for the most zones.
 */
export function getTimeZoneShortName(
  timeZone: string,
  // eslint-disable-next-line no-restricted-syntax
  date: Date = new Date(),
): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value ?? timeZone
  );
}
