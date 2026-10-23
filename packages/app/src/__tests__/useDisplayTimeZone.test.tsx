import { renderHook } from '@testing-library/react';

import {
  TimeZoneOverrideProvider,
  useTimeZoneLinkParam,
  useTimeZoneOverride,
  withTimeZoneParam,
} from '@/timeZoneOverride';
import { useDisplayTimeZone } from '@/useDisplayTimeZone';

let mockTz: string | null = null;
const mockSetTz = jest.fn();
jest.mock('nuqs', () => ({
  parseAsString: {},
  useQueryState: () => [mockTz, mockSetTz],
}));

let mockUserTimeZone = 'Etc/UTC';
jest.mock('@/useUserPreferences', () => ({
  useUserPreferences: () => ({
    userPreferences: { timeZone: mockUserTimeZone },
  }),
}));

const withProvider = ({ children }: { children: React.ReactNode }) => (
  <TimeZoneOverrideProvider>{children}</TimeZoneOverrideProvider>
);

describe('useDisplayTimeZone', () => {
  beforeEach(() => {
    mockTz = null;
    mockUserTimeZone = 'Etc/UTC';
    mockSetTz.mockClear();
  });

  it('uses the user setting outside a page override', () => {
    mockTz = 'Asia/Tokyo';
    const { result } = renderHook(() => useDisplayTimeZone());
    expect(result.current).toBe('Etc/UTC');
  });

  it('uses the user setting when the page has no override', () => {
    const { result } = renderHook(() => useDisplayTimeZone(), {
      wrapper: withProvider,
    });
    expect(result.current).toBe('Etc/UTC');
  });

  it('prefers the page override', () => {
    mockTz = 'Asia/Tokyo';
    const { result } = renderHook(() => useDisplayTimeZone(), {
      wrapper: withProvider,
    });
    expect(result.current).toBe('Asia/Tokyo');
  });

  it('lets the page override to local time', () => {
    mockTz = 'local';
    const { result } = renderHook(() => useDisplayTimeZone(), {
      wrapper: withProvider,
    });
    expect(result.current).toBeUndefined();
  });

  it('ignores an override the browser does not recognise', () => {
    mockTz = 'Mars/Olympus_Mons';
    const { result } = renderHook(
      () => ({
        displayTimeZone: useDisplayTimeZone(),
        override: useTimeZoneOverride(),
      }),
      { wrapper: withProvider },
    );
    expect(result.current.displayTimeZone).toBe('Etc/UTC');
    expect(result.current.override?.timeZone).toBeNull();
  });

  it('writes the override to the URL', () => {
    const { result } = renderHook(() => useTimeZoneOverride(), {
      wrapper: withProvider,
    });
    result.current?.setTimeZone('Asia/Tokyo');
    expect(mockSetTz).toHaveBeenCalledWith('Asia/Tokyo');
    result.current?.setTimeZone(null);
    expect(mockSetTz).toHaveBeenCalledWith(null);
  });
});

describe('withTimeZoneParam', () => {
  it('appends tz to a URL with or without a query', () => {
    expect(withTimeZoneParam('/search', 'Asia/Tokyo')).toBe(
      '/search?tz=Asia%2FTokyo',
    );
    expect(withTimeZoneParam('/search?from=1&to=2', 'Etc/UTC')).toBe(
      '/search?from=1&to=2&tz=Etc%2FUTC',
    );
  });

  it('keeps the hash after the query', () => {
    expect(withTimeZoneParam('/dashboards/1?a=b#tile', 'local')).toBe(
      '/dashboards/1?a=b&tz=local#tile',
    );
  });

  it('leaves the URL unchanged without an override', () => {
    expect(withTimeZoneParam('/search?a=b', null)).toBe('/search?a=b');
  });

  it('keeps existing param encoding intact', () => {
    const where = encodeURIComponent(encodeURIComponent('a = 1\nb = 2'));
    expect(withTimeZoneParam(`/search?where=${where}`, 'Etc/UTC')).toBe(
      `/search?where=${where}&tz=Etc%2FUTC`,
    );
  });
});

describe('useTimeZoneLinkParam', () => {
  beforeEach(() => {
    mockTz = null;
  });

  it("adds the page's override to links", () => {
    mockTz = 'Asia/Tokyo';
    const { result } = renderHook(() => useTimeZoneLinkParam(), {
      wrapper: withProvider,
    });
    expect(result.current('/search')).toBe('/search?tz=Asia%2FTokyo');
  });

  it('leaves links unchanged without an override', () => {
    const { result } = renderHook(() => useTimeZoneLinkParam(), {
      wrapper: withProvider,
    });
    expect(result.current('/search')).toBe('/search');
  });
});
