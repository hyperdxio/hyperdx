import { renderHook } from '@testing-library/react';

import { useDefaultTimeRange } from '@/timeQuery';

describe('useDefaultTimeRange', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evaluates relative queries against the current clock at mount time', () => {
    // Set initial time to Jan 1, 2024 12:00:00
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));

    const { result, unmount } = renderHook(() =>
      useDefaultTimeRange('Past 15m'),
    );

    const [start1, end1] = result.current;
    expect(end1.getTime()).toBe(new Date('2024-01-01T12:00:00.000Z').getTime());
    expect(start1.getTime()).toBe(
      new Date('2024-01-01T11:45:00.000Z').getTime(),
    );

    unmount();

    // Advance time by 30 minutes
    jest.setSystemTime(new Date('2024-01-01T12:30:00.000Z'));

    const { result: result2 } = renderHook(() =>
      useDefaultTimeRange('Past 15m'),
    );

    const [start2, end2] = result2.current;
    expect(end2.getTime()).toBe(new Date('2024-01-01T12:30:00.000Z').getTime());
    expect(start2.getTime()).toBe(
      new Date('2024-01-01T12:15:00.000Z').getTime(),
    );
  });
});
