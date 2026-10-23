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

/** Offset of `timeZone` at `date`, e.g. "UTC-07:00". */
export function getTimeZoneOffsetLabel(
  timeZone: string,
  // eslint-disable-next-line no-restricted-syntax
  date: Date = new Date(),
): string {
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  // Zero offsets come back as plain "GMT" in some runtimes.
  return offset === 'GMT' ? 'UTC+00:00' : gmtToUtc(offset);
}

/** "America/Los_Angeles" as "America/Los Angeles". */
export function formatTimeZoneName(timeZone: string): string {
  return timeZone.replaceAll('_', ' ');
}

/**
 * Short name of `timeZone` at `date`, e.g. "UTC", "PDT" or "UTC+9". en-US is
 * used because it has abbreviations for the most zones.
 */
export function getTimeZoneShortName(
  timeZone: string,
  // eslint-disable-next-line no-restricted-syntax
  date: Date = new Date(),
): string {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(date)
    .find(part => part.type === 'timeZoneName')?.value;
  return name ? gmtToUtc(name) : timeZone;
}
