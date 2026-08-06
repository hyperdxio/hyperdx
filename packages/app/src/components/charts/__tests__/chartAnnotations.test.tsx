import { ReactElement } from 'react';
import { ReferenceLine } from 'recharts';

import {
  type ChartAnnotation,
  getAnnotationElements,
  labelSeparationPx,
  MAX_ANNOTATION_MARKERS,
  mergeAnnotations,
  resolveAnnotationSeries,
} from '@/components/charts/chartAnnotations';

// ReferenceLine element props are typed loosely; narrow for assertions.
const lineProps = (el: ReactElement) =>
  el.props as {
    stroke: string;
    strokeDasharray?: string;
    strokeOpacity?: number;
    x: number;
    label?: { props: { value: string } };
  };

const labelOf = (el: ReactElement) => lineProps(el).label?.props.value;

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

  it('drops an unparseable time instead of rendering a broken line', () => {
    const lines = getAnnotationElements(
      [{ time: 'not a date' }, { time: 1_000_300_000 }],
      bounded,
    );

    expect(lines).toHaveLength(1);
    expect(lineProps(lines[0]).x).toBe(1_000_300);
  });
});

describe('mergeAnnotations', () => {
  const at = (ms: number, label: string): ChartAnnotation => ({
    time: ms,
    label,
  });

  it('returns undefined when every list is empty or absent', () => {
    expect(mergeAnnotations(undefined, [], undefined)).toBeUndefined();
  });

  it('concatenates lists in ascending time order, ignoring absent ones', () => {
    const merged = mergeAnnotations(
      [at(3_000, 'c'), at(1_000, 'a')],
      undefined,
      [at(2_000, 'b')],
    );

    expect(merged?.map(a => a.label)).toEqual(['a', 'b', 'c']);
  });

  it('sorts mixed Date / ISO / epoch-ms times together', () => {
    const merged = mergeAnnotations(
      [{ time: new Date(3_000), label: 'c' }],
      [{ time: '1970-01-01T00:00:01.000Z', label: 'a' }],
      [{ time: 2_000, label: 'b' }],
    );

    expect(merged?.map(a => a.label)).toEqual(['a', 'b', 'c']);
  });

  // Recharts 3 keeps props in an Immer store and hands back frozen arrays, so
  // merging must never sort a caller's list in place.
  it('does not mutate or reorder the input lists', () => {
    const input = Object.freeze([at(3_000, 'c'), at(1_000, 'a')]);

    expect(() => mergeAnnotations(input)).not.toThrow();
    expect(input.map(a => a.label)).toEqual(['c', 'a']);
  });
});

describe('labelSeparationPx', () => {
  // Labels are centered on their marker, so the room two neighbours need is
  // half of each width, plus a gap.
  it('scales with the combined width of both labels', () => {
    expect(labelSeparationPx('1.0.0', '2.0.0')).toBeLessThan(
      labelSeparationPx('2026.08.04-abcdef12', '2026.08.04-abcdef34'),
    );
  });

  it('still separates unlabelled markers by a gap', () => {
    expect(labelSeparationPx(undefined, undefined)).toBeGreaterThan(0);
  });
});

describe('getAnnotationElements label collapsing', () => {
  // 1000px over a 1000s domain => 1px per second, so a marker's `time` in
  // seconds is also its pixel offset.
  const collapsing = {
    domain: [0, 1000] as [number, number],
    plotWidth: 1000,
  };
  const deploy = (seconds: number, label: string): ChartAnnotation => ({
    time: seconds * 1000,
    label,
    kind: 'deployment',
    groupNoun: 'deploys',
  });

  it('leaves markers with room for both labels individually labelled', () => {
    const lines = getAnnotationElements(
      [deploy(0, '1.0.0'), deploy(60, '2.0.0')],
      collapsing,
    );

    expect(lines.map(labelOf)).toEqual(['1.0.0', '2.0.0']);
  });

  it('collapses markers whose labels would overlap', () => {
    const lines = getAnnotationElements(
      [deploy(0, '1.0.0'), deploy(20, '2.0.0')],
      collapsing,
    );

    expect(lines.map(labelOf)).toEqual(['2 deploys', undefined]);
  });

  // Regression: a fixed separation let long version strings render on top of
  // each other ("2.0.0" and "2 deploys" colliding into "2.0.02 depl…").
  it('reserves more room for longer labels at the same spacing', () => {
    const lines = getAnnotationElements(
      [deploy(0, '2026.08.04-abcdef12'), deploy(60, '2026.08.04-abcdef34')],
      collapsing,
    );

    // Same 60px gap that leaves short labels alone is not enough for these.
    expect(lines.map(labelOf)).toEqual(['2 deploys', undefined]);
  });

  // Anchoring on the group's first member (not the running last one) is what
  // stops a chain of near-threshold gaps collapsing into one giant group.
  it('groups against the first member, not the running last one', () => {
    const lines = getAnnotationElements(
      [
        deploy(0, '1.0.0-beta'),
        deploy(40, '1.1.0-beta'),
        deploy(100, '1.2.0-beta'),
      ],
      collapsing,
    );

    // 40 is inside the anchor's label footprint; 100 is clear of it and starts
    // its own group. Anchoring on the last member would have swallowed it.
    expect(lines).toHaveLength(3);
    expect(labelOf(lines[0])).toBe('2 deploys');
    expect(labelOf(lines[1])).toBeUndefined();
    expect(labelOf(lines[2])).toBe('1.2.0-beta');
  });

  it('mutes the line of a marker whose label was collapsed away', () => {
    const [anchor, absorbed] = getAnnotationElements(
      [deploy(0, '1.0.0'), deploy(10, '2.0.0')],
      collapsing,
    );

    expect(lineProps(anchor).strokeOpacity).toBe(0.9);
    expect(lineProps(absorbed).strokeOpacity).toBeLessThan(0.9);
    // The line is still drawn, so a dense cluster stays visible.
    expect(lineProps(absorbed).x).toBe(10);
  });

  it('falls back to "events" when no group noun is supplied', () => {
    const lines = getAnnotationElements(
      [
        { time: 0, label: 'a', kind: 'alert' },
        { time: 10_000, label: 'b', kind: 'alert' },
      ],
      collapsing,
    );

    expect(labelOf(lines[0])).toBe('2 events');
  });

  it('never collapses markers of different kinds together', () => {
    const lines = getAnnotationElements(
      [deploy(0, '1.0.0'), { time: 5_000, label: 'Alert', kind: 'alert' }],
      collapsing,
    );

    // Both are within each other's label footprint, but they are different
    // kinds, so each keeps its own label rather than becoming "2 deploys".
    expect(lines.map(labelOf).sort()).toEqual(['1.0.0', 'Alert']);
  });

  it('labels everything when the plot width is not yet measured', () => {
    const annotations = [deploy(0, '1.0.0'), deploy(10, '2.0.0')];

    // plotWidth 0 is the pre-measure state; omitted is the legacy caller.
    expect(
      getAnnotationElements(annotations, { ...collapsing, plotWidth: 0 }).map(
        labelOf,
      ),
    ).toEqual(['1.0.0', '2.0.0']);
    expect(
      getAnnotationElements(annotations, {
        domain: collapsing.domain,
      }).map(labelOf),
    ).toEqual(['1.0.0', '2.0.0']);
  });

  it('labels everything when the domain collapses to a single point', () => {
    const lines = getAnnotationElements([deploy(5, 'v1'), deploy(5, 'v2')], {
      domain: [5, 5],
      plotWidth: 1000,
    });

    expect(lines.map(labelOf)).toEqual(['v1', 'v2']);
  });

  it('still caps the rendered markers after collapsing', () => {
    const many = Array.from({ length: MAX_ANNOTATION_MARKERS + 50 }, (_, i) =>
      deploy(i / 10, `v${i}`),
    );

    expect(getAnnotationElements(many, collapsing)).toHaveLength(
      MAX_ANNOTATION_MARKERS,
    );
  });
});

describe('resolveAnnotationSeries', () => {
  const deploy = (group: string, label: string): ChartAnnotation => ({
    time: 1_000,
    label,
    group,
    color: '#fallback',
  });
  // A chart grouped by service: each of these has its own line.
  const charted = (group: string) =>
    ({ checkout: '#blue', payments: '#teal' })[group];
  const nothingCharted = () => undefined;

  it('tints a marker to match its series', () => {
    const [resolved] = resolveAnnotationSeries(
      [deploy('checkout', '1.0.0')],
      charted,
    );

    expect(resolved.color).toBe('#blue');
  });

  it('keeps markers for every service the chart breaks out', () => {
    const resolved = resolveAnnotationSeries(
      [deploy('checkout', '1.0.0'), deploy('payments', '2.0.0')],
      charted,
    );

    expect(resolved.map(a => a.color)).toEqual(['#blue', '#teal']);
  });

  // A tile filtered to one service: there is no per-service line to match, but
  // the whole chart is about that service, so the markers are unambiguous.
  it('keeps markers when every one belongs to the same group', () => {
    const resolved = resolveAnnotationSeries(
      [deploy('checkout', '1.0.0'), deploy('checkout', '2.0.0')],
      nothingCharted,
    );

    expect(resolved.map(a => a.label)).toEqual(['1.0.0', '2.0.0']);
    // No series to borrow from, so the marker keeps its own color.
    expect(resolved[0].color).toBe('#fallback');
  });

  // The case this rule exists for: an aggregate line over several services.
  // A marker naming a service the reader cannot locate invites false
  // attribution, so it is dropped rather than drawn.
  it('drops markers that span several groups none of which are charted', () => {
    const resolved = resolveAnnotationSeries(
      [deploy('checkout', '1.0.0'), deploy('payments', '2.0.0')],
      nothingCharted,
    );

    expect(resolved).toEqual([]);
  });

  it('keeps only the charted services when a chart shows a subset', () => {
    const resolved = resolveAnnotationSeries(
      [
        deploy('checkout', '1.0.0'),
        deploy('payments', '2.0.0'),
        deploy('billing', '3.0.0'),
      ],
      charted,
    );

    expect(resolved.map(a => a.label)).toEqual(['1.0.0', '2.0.0']);
  });

  // Alert markers describe the whole chart, not one series.
  it('always keeps markers that carry no group', () => {
    const resolved = resolveAnnotationSeries(
      [
        { time: 1_000, label: 'Alert', color: '#red' },
        deploy('checkout', '1.0.0'),
        deploy('payments', '2.0.0'),
      ],
      nothingCharted,
    );

    expect(resolved.map(a => a.label)).toEqual(['Alert']);
  });

  it('returns an empty list for no annotations', () => {
    expect(resolveAnnotationSeries([], charted)).toEqual([]);
  });

  it('does not mutate the input annotations', () => {
    const input = deploy('checkout', '1.0.0');
    resolveAnnotationSeries([input], charted);

    expect(input.color).toBe('#fallback');
  });
});
