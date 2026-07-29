import { ReactElement } from 'react';
import { ReferenceLine } from 'recharts';

import {
  getAnnotationElements,
  MAX_ANNOTATION_MARKERS,
} from '@/components/charts/chartAnnotations';

// ReferenceLine element props are typed loosely; narrow for assertions.
const lineProps = (el: ReactElement) =>
  el.props as {
    stroke: string;
    strokeDasharray?: string;
    x: number;
    label?: unknown;
  };

// A domain wide enough that no marker clamps, and one bounded window for the
// clamp cases.
const wide = { domain: [0, 2_000_000_000] as [number, number] };
const bounded = { domain: [1_000_000, 1_000_600] as [number, number] };

describe('getAnnotationElements', () => {
  it('returns nothing for an empty list', () => {
    expect(getAnnotationElements([], wide)).toEqual([]);
  });

  it('renders a dashed reference line at the unix-second x, with color and label', () => {
    const ms = 1_000_300_000; // 1_000_300s, inside `bounded`
    const [line] = getAnnotationElements(
      [{ time: ms, label: 'Alert', color: '#123456' }],
      bounded,
    );

    expect(line.type).toBe(ReferenceLine);
    expect(lineProps(line).x).toBe(1_000_300);
    expect(lineProps(line).strokeDasharray).toBe('3 3');
    expect(lineProps(line).stroke).toBe('#123456');
    expect(lineProps(line).label).toBeTruthy();
  });

  it('accepts Date / epoch-ms times, defaults the color, and omits an absent label', () => {
    const ms = 1_000_300_000;
    const [fromMs] = getAnnotationElements([{ time: ms }], bounded);
    const [fromDate] = getAnnotationElements([{ time: new Date(ms) }], bounded);

    expect(lineProps(fromMs).x).toBe(1_000_300);
    expect(lineProps(fromDate).x).toBe(1_000_300);
    expect(lineProps(fromMs).stroke).toBe('var(--color-border)');
    expect(lineProps(fromMs).label).toBeUndefined();
  });

  // Regression: an "already firing at window open" marker pinned to a coarser
  // (minute-floored) start time used to fall left of a sub-minute chart domain
  // and get dropped by Recharts. It must now snap to the left edge instead.
  it('clamps a marker before the domain to the left edge', () => {
    const beforeStart = (bounded.domain[0] - 100) * 1000;
    const [line] = getAnnotationElements([{ time: beforeStart }], bounded);

    expect(lineProps(line).x).toBe(bounded.domain[0]);
  });

  it('clamps a marker after the domain to the right edge', () => {
    const afterEnd = (bounded.domain[1] + 100) * 1000;
    const [line] = getAnnotationElements([{ time: afterEnd }], bounded);

    expect(lineProps(line).x).toBe(bounded.domain[1]);
  });

  it('leaves an in-range marker unclamped', () => {
    const inRange = (bounded.domain[0] + 300) * 1000;
    const [line] = getAnnotationElements([{ time: inRange }], bounded);

    expect(lineProps(line).x).toBe(bounded.domain[0] + 300);
  });

  it('caps the number of rendered markers', () => {
    const many = Array.from(
      { length: MAX_ANNOTATION_MARKERS + 50 },
      (_, i) => ({ time: 1_700_000_000_000 + i * 60_000 }),
    );
    expect(getAnnotationElements(many, wide)).toHaveLength(
      MAX_ANNOTATION_MARKERS,
    );
  });

  it('uses a provided key and falls back to a generated one', () => {
    const lines = getAnnotationElements(
      [
        { time: '2026-07-01T00:00:00.000Z', key: 'custom' },
        { time: '2026-07-01T00:00:00.000Z' },
      ],
      wide,
    );

    expect(lines[0].key).toBe('custom');
    expect(lines[1].key).toEqual(expect.any(String));
    expect(lines[0].key).not.toEqual(lines[1].key);
  });
});
