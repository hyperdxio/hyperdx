import {
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

describe('getTimeZoneShortName', () => {
  it('uses the abbreviation in effect on the date', () => {
    expect(
      getTimeZoneShortName('America/Los_Angeles', new Date('2026-07-01Z')),
    ).toBe('PDT');
    expect(
      getTimeZoneShortName('America/Los_Angeles', new Date('2026-12-01Z')),
    ).toBe('PST');
  });

  it('names UTC and zones without an abbreviation', () => {
    expect(getTimeZoneShortName('Etc/UTC')).toBe('UTC');
    expect(getTimeZoneShortName('Asia/Tokyo')).toBe('GMT+9');
  });
});
