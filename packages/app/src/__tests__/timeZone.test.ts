import {
  formatTimeZoneName,
  getSupportedTimeZones,
  getTimeZoneOffsetLabel,
  getTimeZoneShortName,
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

describe('getTimeZoneOffsetLabel', () => {
  it('uses the offset in effect on the date', () => {
    expect(
      getTimeZoneOffsetLabel('America/Los_Angeles', new Date('2026-07-01Z')),
    ).toBe('UTC-07:00');
    expect(
      getTimeZoneOffsetLabel('America/Los_Angeles', new Date('2026-12-01Z')),
    ).toBe('UTC-08:00');
    expect(getTimeZoneOffsetLabel('Asia/Kolkata')).toBe('UTC+05:30');
  });

  it('labels UTC with a zero offset', () => {
    expect(getTimeZoneOffsetLabel('Etc/UTC')).toBe('UTC+00:00');
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
  it('uses the abbreviation in effect on the date', () => {
    expect(
      getTimeZoneShortName('America/Los_Angeles', new Date('2026-07-01Z')),
    ).toBe('PDT');
    expect(
      getTimeZoneShortName('America/Los_Angeles', new Date('2026-12-01Z')),
    ).toBe('PST');
  });

  it('names UTC and labels zones without an abbreviation from UTC', () => {
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
