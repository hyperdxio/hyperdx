import { ReactElement } from 'react';

import {
  getAnnotationReferenceLines,
  MAX_ANNOTATION_MARKERS,
} from '@/components/charts/chartAnnotations';

// ReferenceLine element props are typed as `unknown`; narrow for assertions.
const lineProps = (el: ReactElement) =>
  el.props as { stroke: string; x: number; label?: unknown };

describe('getAnnotationReferenceLines', () => {
  it('returns nothing for an empty list', () => {
    expect(getAnnotationReferenceLines([])).toEqual([]);
  });

  it('renders a line per annotation at the unix-second x, with color and label', () => {
    const time = '2026-07-01T00:05:00.000Z';
    const [line] = getAnnotationReferenceLines([
      { time, label: 'Deploy', color: '#123456' },
    ]);

    expect(lineProps(line).x).toBe(new Date(time).getTime() / 1000);
    expect(lineProps(line).stroke).toBe('#123456');
    expect(lineProps(line).label).toBeTruthy();
  });

  it('accepts Date / epoch-ms times, defaults the color, and omits an absent label', () => {
    const ms = Date.UTC(2026, 6, 1, 0, 5, 0);
    const [fromMs] = getAnnotationReferenceLines([{ time: ms }]);
    const [fromDate] = getAnnotationReferenceLines([{ time: new Date(ms) }]);

    expect(lineProps(fromMs).x).toBe(ms / 1000);
    expect(lineProps(fromDate).x).toBe(ms / 1000);
    expect(lineProps(fromMs).stroke).toBe('var(--color-border)');
    expect(lineProps(fromMs).label).toBeUndefined();
  });

  it('caps the number of rendered markers', () => {
    const many = Array.from(
      { length: MAX_ANNOTATION_MARKERS + 50 },
      (_, i) => ({ time: 1_700_000_000_000 + i * 60_000 }),
    );
    expect(getAnnotationReferenceLines(many)).toHaveLength(
      MAX_ANNOTATION_MARKERS,
    );
  });

  it('uses a provided key and falls back to a generated one', () => {
    const lines = getAnnotationReferenceLines([
      { time: '2026-07-01T00:00:00.000Z', key: 'custom' },
      { time: '2026-07-01T00:00:00.000Z' },
    ]);

    expect(lines[0].key).toBe('custom');
    expect(lines[1].key).toEqual(expect.any(String));
    expect(lines[0].key).not.toEqual(lines[1].key);
  });
});
