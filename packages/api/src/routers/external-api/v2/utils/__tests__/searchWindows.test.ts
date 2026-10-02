import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { resolveSearchWindows } from '@/routers/external-api/v2/utils/search';

const source = {
  kind: SourceKind.Log,
  timestampValueExpression: 'Timestamp',
} as unknown as TSource;

const START = new Date('2026-05-10T00:00:00.000Z');
const END = new Date('2026-05-11T00:00:00.000Z');

describe('resolveSearchWindows', () => {
  it('windows a timestamp-led descending order', () => {
    const windows = resolveSearchWindows(source, 'Timestamp DESC', START, END);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].direction).toBe('DESC');
    expect(windows[0].endTime).toEqual(END);
  });

  it('windows a timestamp-led ascending order in the other direction', () => {
    const windows = resolveSearchWindows(source, 'Timestamp ASC', START, END);
    expect(windows[0].direction).toBe('ASC');
    expect(windows[0].startTime).toEqual(START);
  });

  it('disengages windowing when the order does not lead with the timestamp', () => {
    const windows = resolveSearchWindows(
      source,
      'SeverityText DESC',
      START,
      END,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].startTime).toEqual(START);
    expect(windows[0].endTime).toEqual(END);
  });

  it('returns exactly one window when start equals end', () => {
    const windows = resolveSearchWindows(
      source,
      'Timestamp DESC',
      START,
      START,
    );
    expect(windows).toHaveLength(1);
  });

  it('covers the full range with no gaps between adjacent windows', () => {
    const windows = resolveSearchWindows(source, 'Timestamp DESC', START, END);
    for (let i = 0; i + 1 < windows.length; i++) {
      expect(windows[i].startTime).toEqual(windows[i + 1].endTime);
    }
    expect(windows[windows.length - 1].startTime).toEqual(START);
    expect(windows[0].endTime).toEqual(END);
  });
});
