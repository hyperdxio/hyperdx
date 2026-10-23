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

/** Whether `value` is a time zone setting this browser can use. */
export function isTimeZonePreference(value: string): boolean {
  return value === LOCAL_TIME_ZONE || isValidTimeZone(value);
}

/** "Local", "UTC", or the zone's name, e.g. "Asia/Tokyo". */
export function getTimeZonePreferenceLabel(preference: string): string {
  const timeZone = resolveTimeZonePreference(preference);
  if (timeZone == null) {
    return 'Local';
  }
  return timeZone === UTC_TIME_ZONE ? 'UTC' : formatTimeZoneName(timeZone);
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

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** IANA zones the browser knows, other than UTC, in alphabetical order. */
export function getSupportedTimeZones(): string[] {
  return Intl.supportedValuesOf('timeZone').filter(
    zone => zone !== 'UTC' && zone !== UTC_TIME_ZONE,
  );
}

// Intl labels offsets from GMT ("GMT+9"); we label them from UTC everywhere.
function gmtToUtc(label: string): string {
  return label.replace(/^GMT/, 'UTC');
}

/** "America/Los_Angeles" as "America/Los Angeles". */
export function formatTimeZoneName(timeZone: string): string {
  return timeZone.replaceAll('_', ' ');
}

/**
 * Short offset of `timeZone` at `date`, e.g. "UTC-7" or "UTC+5:30", or "UTC"
 * for a zero offset. Offsets rather than abbreviations like "PDT", which only
 * exist for some zones and are ambiguous.
 */
export function getTimeZoneShortName(
  timeZone: string,
  // eslint-disable-next-line no-restricted-syntax
  date: Date = new Date(),
): string {
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find(part => part.type === 'timeZoneName')?.value;
  if (offset == null) {
    return timeZone;
  }
  // Zero offsets come back as "GMT+0", or plain "GMT" in some runtimes.
  const label = gmtToUtc(offset);
  return label === 'UTC+0' ? 'UTC' : label;
}
