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

  it('falls back to the current clock for unparseable queries', () => {
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));

    const { result, unmount } = renderHook(() =>
      useDefaultTimeRange('unparseable string'),
    );

    const [start1, end1] = result.current;
    expect(end1.getTime()).toBe(new Date('2024-01-01T12:00:00.000Z').getTime());
    expect(start1.getTime()).toBe(
      new Date('2024-01-01T11:00:00.000Z').getTime(),
    );

    unmount();

    jest.setSystemTime(new Date('2024-01-01T12:30:00.000Z'));

    const { result: result2 } = renderHook(() =>
      useDefaultTimeRange('unparseable string'),
    );

    const [start2, end2] = result2.current;
    expect(end2.getTime()).toBe(new Date('2024-01-01T12:30:00.000Z').getTime());
    expect(start2.getTime()).toBe(
      new Date('2024-01-01T11:30:00.000Z').getTime(),
    );
  });

  it('maintains referential stability across re-renders when the query is unchanged', () => {
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));

    const { result, rerender } = renderHook(
      ({ query }) => useDefaultTimeRange(query),
      { initialProps: { query: 'Past 15m' } },
    );

    const initialReference = result.current;

    jest.setSystemTime(new Date('2024-01-01T12:05:00.000Z'));
    rerender({ query: 'Past 15m' });

    expect(result.current).toBe(initialReference);

    jest.setSystemTime(new Date('2024-01-01T12:10:00.000Z'));
    rerender({ query: 'Past 15m' });

    expect(result.current).toBe(initialReference);
  });

  it('updates the reference and evaluates against the current clock when the query changes', () => {
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));

    const { result, rerender } = renderHook(
      ({ query }) => useDefaultTimeRange(query),
      { initialProps: { query: 'Past 15m' } },
    );

    const initialReference = result.current;

    jest.setSystemTime(new Date('2024-01-01T12:30:00.000Z'));
    rerender({ query: 'Past 1h' });

    expect(result.current).not.toBe(initialReference);

    const [start, end] = result.current;
    expect(end.getTime()).toBe(new Date('2024-01-01T12:30:00.000Z').getTime());
    expect(start.getTime()).toBe(
      new Date('2024-01-01T11:30:00.000Z').getTime(),
    );
  });
});
