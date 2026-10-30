import { act, renderHook } from '@testing-library/react';

import { useTimeRangeInputText } from '@/timeQuery';

let mockTimeZone: string | undefined = 'Etc/UTC';
jest.mock('@/useDisplayTimeZone', () => ({
  useDisplayTimeZone: () => mockTimeZone,
}));

const range: [Date, Date] = [
  new Date('2026-10-22T14:00:00Z'),
  new Date('2026-10-22T15:00:00Z'),
];

describe('useTimeRangeInputText', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T00:00:00Z'));
    mockTimeZone = 'Etc/UTC';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('formats the range in the display time zone', () => {
    const { result } = renderHook(() => useTimeRangeInputText(range));
    expect(result.current[0]).toBe('Oct 22 14:00:00 - Oct 22 15:00:00');
  });

  it('keeps edited text while the zone is unchanged', () => {
    const { result, rerender } = renderHook(() => useTimeRangeInputText(range));
    act(() => result.current[1]('last monday'));
    rerender();
    expect(result.current[0]).toBe('last monday');
  });

  it('re-formats the range when the zone changes', () => {
    const { result, rerender } = renderHook(() => useTimeRangeInputText(range));
    act(() => result.current[1]('last monday'));

    mockTimeZone = 'Asia/Tokyo';
    rerender();

    expect(result.current[0]).toBe('Oct 22 23:00:00 - Oct 23 00:00:00');
  });
});
