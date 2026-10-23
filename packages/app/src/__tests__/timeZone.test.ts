import {
  formatTimeZoneName,
  getSupportedTimeZones,
  getTimeZonePreferenceLabel,
  getTimeZoneShortName,
  isTimeZonePreference,
  isValidTimeZone,
  LOCAL_TIME_ZONE,
  resolveTimeZonePreference,
} from '@/timeZone';

describe('resolveTimeZonePreference', () => {
  it('returns undefined for the local setting', () => {
    expect(resolveTimeZonePreference(LOCAL_TIME_ZONE)).toBeUndefined();
  });

  it('returns a valid IANA name', () => {
    expect(resolveTimeZonePreference('Etc/UTC')).toBe('Etc/UTC');
    expect(resolveTimeZonePreference('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('falls back to local for a zone the browser does not recognise', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(resolveTimeZonePreference('Mars/Olympus_Mons')).toBeUndefined();
  });
});

describe('isTimeZonePreference', () => {
  it('accepts local and zones the browser knows', () => {
    expect(isTimeZonePreference(LOCAL_TIME_ZONE)).toBe(true);
    expect(isTimeZonePreference('Asia/Tokyo')).toBe(true);
    expect(isTimeZonePreference('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('getTimeZonePreferenceLabel', () => {
  it('names local, UTC and other zones', () => {
    expect(getTimeZonePreferenceLabel(LOCAL_TIME_ZONE)).toBe('Local');
    expect(getTimeZonePreferenceLabel('Etc/UTC')).toBe('UTC');
    expect(getTimeZonePreferenceLabel('America/Los_Angeles')).toBe(
      'America/Los Angeles',
    );
  });
});

describe('getSupportedTimeZones', () => {
  it('lists named zones without UTC', () => {
    const zones = getSupportedTimeZones();
    expect(zones).toContain('Asia/Tokyo');
    expect(zones).not.toContain('UTC');
    expect(zones).not.toContain('Etc/UTC');
  });
});

describe('formatTimeZoneName', () => {
  it('replaces underscores with spaces', () => {
    expect(formatTimeZoneName('America/Los_Angeles')).toBe(
      'America/Los Angeles',
    );
  });
});

describe('getTimeZoneShortName', () => {
  it('uses the offset in effect on the date, not an abbreviation', () => {
    expect(
      getTimeZoneShortName('America/Los_Angeles', new Date('2026-07-01Z')),
    ).toBe('UTC-7');
    expect(
      getTimeZoneShortName('America/Los_Angeles', new Date('2026-12-01Z')),
    ).toBe('UTC-8');
  });

  it('names a zero offset UTC and keeps partial-hour offsets', () => {
    expect(getTimeZoneShortName('Etc/UTC')).toBe('UTC');
    expect(getTimeZoneShortName('Asia/Tokyo')).toBe('UTC+9');
    expect(getTimeZoneShortName('Asia/Kolkata')).toBe('UTC+5:30');
    expect(getTimeZoneShortName('Europe/London', new Date('2026-01-15Z'))).toBe(
      'UTC',
    );
    expect(getTimeZoneShortName('Europe/London', new Date('2026-07-15Z'))).toBe(
      'UTC+1',
    );
  });
});
