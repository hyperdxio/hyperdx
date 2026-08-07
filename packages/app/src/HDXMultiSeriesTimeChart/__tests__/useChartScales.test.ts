import { isValidElement } from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { type LineData } from '@/ChartUtils';
import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import { useChartScales } from '@/HDXMultiSeriesTimeChart/useChartScales';

/**
 * The pure seam this refactor created: axis domains and annotation elements
 * derived from props, with no state and no recharts tree. The branching that
 * used to be buried in MemoChart — fit-to-data, legend selection, zero-anchored
 * bars, the half-bucket bar padding — is what these cases pin.
 */
const series = (dataKey: string, displayName: string): LineData => ({
  dataKey,
  displayName,
  currentPeriodKey: dataKey,
  previousPeriodKey: `${dataKey}-prev`,
  valueColumnName: dataKey,
  color: '#000000',
});

const lineData: LineData[] = [series('a', 'A'), series('b', 'B')];

const baseArgs = {
  annotations: undefined as ChartAnnotation[] | undefined,
  dateRange: [
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T01:00:00Z'),
  ] as readonly [Date, Date],
  granularity: '1 minute',
  dateRangeEndInclusive: true,
  displayType: DisplayType.Line,
  fitYAxisToData: false,
  graphResults: [
    { a: 10, b: 20 },
    { a: 30, b: 40 },
  ] as Record<string, unknown>[],
  lineData,
  selectedSeriesNames: undefined as Set<string> | undefined,
  hasExemplars: false,
};

const scales = (overrides: Partial<typeof baseArgs> = {}) =>
  renderHook(() => useChartScales({ ...baseArgs, ...overrides })).result
    .current;

describe('useChartScales y-domain', () => {
  it('lets recharts auto-scale from zero with no selection and no fit', () => {
    expect(scales().yAxisDomain).toEqual([0, 'auto']);
  });

  it('fits the lower bound to the data minimum, less padding', () => {
    // min 10, max 40 -> 5% padding is 1.5.
    expect(scales({ fitYAxisToData: true }).yAxisDomain).toEqual([8.5, 41.5]);
  });

  it('does not let the padding drag the axis below zero', () => {
    // min 1, max 100 -> padding 4.95 would put the floor at -3.95, and a chart of
    // durations whose axis starts below zero reads as broken. The clamp only
    // lifts when the data itself goes negative.
    expect(
      scales({
        fitYAxisToData: true,
        graphResults: [{ a: 1, b: 100 }],
      }).yAxisDomain,
    ).toEqual([0, 104.95]);
  });

  it('follows the data minimum when fitting and the data is negative', () => {
    // min -50, max 25 -> 5% of the 75 range is 3.75, applied to both ends.
    expect(
      scales({
        fitYAxisToData: true,
        graphResults: [
          { a: -50, b: -10 },
          { a: 0, b: 25 },
        ],
      }).yAxisDomain,
    ).toEqual([-53.75, 28.75]);
  });

  it('ignores deselected series when computing the range', () => {
    // A alone spans 10..30, so padding is 1 and the domain is [9, 31]. With B
    // included it would be [8.5, 41.5] — asserting the exact pair catches a
    // wrong padding factor too, which a `toBeLessThan(40)` bound would not.
    expect(scales({ selectedSeriesNames: new Set(['A']) }).yAxisDomain).toEqual(
      [9, 31],
    );
  });

  it('bars stay anchored at zero even when fitting is requested', () => {
    // Otherwise bar lengths stop being proportional to their values.
    expect(
      scales({
        fitYAxisToData: true,
        displayType: DisplayType.StackedBar,
        graphResults: [{ a: 100, b: 110 }],
      }).yAxisDomain,
    ).toEqual([0, 'auto']);
  });

  it('falls back to auto when no numeric values are present', () => {
    expect(
      scales({
        selectedSeriesNames: new Set(['A']),
        graphResults: [{ a: null, b: 'x' }] as Record<string, unknown>[],
      }).yAxisDomain,
    ).toEqual(['auto', 'auto']);
  });
});

describe('useChartScales exemplar clamp', () => {
  // With no selection and no fit the y-domain upper bound is 'auto', so the
  // clamp falls back to the visible series max — which is the whole point: an
  // outlier marker pins to the top of the series range instead of stretching the
  // axis and flattening every line.
  it('bounds markers by the visible series max', () => {
    expect(scales({ hasExemplars: true }).exemplarYBounds).toEqual({
      min: 0,
      max: 40,
    });
  });

  it('follows the legend selection rather than every series', () => {
    // A selection gives the axis numeric bounds, so the clamp takes those
    // directly ([9, 31]) instead of falling back to the series max. Either way
    // it tracks what is on screen — with B shown too it would be [8.5, 41.5].
    expect(
      scales({ hasExemplars: true, selectedSeriesNames: new Set(['A']) })
        .exemplarYBounds,
    ).toEqual({ min: 9, max: 31 });
  });

  it('skips the O(rows x series) scan when no marker can draw', () => {
    // Every time chart in the app pays for this pass otherwise, including
    // deployments running with the overlay switched off entirely.
    expect(scales({ hasExemplars: false }).exemplarYBounds.max).toBe(0);
  });

  it('takes a numeric upper bound from the axis when there is one', () => {
    // Fitting to data gives a real number, and the marker should respect the
    // axis the chart actually drew rather than the raw series max.
    expect(
      scales({ hasExemplars: true, fitYAxisToData: true }).exemplarYBounds,
    ).toEqual({ min: 8.5, max: 41.5 });
  });
});

describe('useChartScales x-domain', () => {
  it('spans the requested range in seconds', () => {
    const [start, end] = scales().xAxisDomain;
    expect(end - start).toBe(3600);
  });

  it('drops the final bucket when the end is exclusive and boundary-aligned', () => {
    // An exclusive end that lands exactly on a bucket boundary would otherwise
    // render an extra empty bucket at the right edge.
    const [, end] = scales({ dateRangeEndInclusive: false }).xAxisDomain;
    const [, inclusiveEnd] = scales().xAxisDomain;
    expect(inclusiveEnd - end).toBe(60);
  });

  it('pads both edges by half a bucket for bars so the full width fits', () => {
    const [start, end] = scales({
      displayType: DisplayType.StackedBar,
    }).xAxisDomain;
    const [plainStart, plainEnd] = scales().xAxisDomain;
    expect(plainStart - start).toBe(30);
    expect(end - plainEnd).toBe(30);
  });
});

describe('useChartScales annotations', () => {
  // `x` is the only thing worth asserting here: the element count is the same
  // whatever time the annotation carries, so a test that only checks for a
  // non-null result passes even when the time is read from the wrong field and
  // every marker lands on NaN.
  const markerX = (annotations: ChartAnnotation[]) =>
    (scales({ annotations }).annotationElements ?? []).map(el =>
      // A guard rather than a cast: the elements come back as ReactElement with
      // unknown props, and asserting the shape would hide a rename of `x`.
      isValidElement<{ x: number }>(el) ? el.props.x : undefined,
    );

  it('renders nothing when there are none', () => {
    expect(scales().annotationElements).toBeNull();
    expect(scales({ annotations: [] }).annotationElements).toBeNull();
  });

  it('places a marker at its own time, in the same unix seconds as the domain', () => {
    const time = new Date('2026-01-01T00:30:00Z');
    expect(markerX([{ time, label: 'deploy' }])).toEqual([
      time.getTime() / 1000,
    ]);
  });

  it('snaps a marker outside the window to the nearest edge', () => {
    // An alert already firing when the window opens has a timestamp before the
    // range; recharts drops such a marker outright, so it is clamped instead.
    const [start, end] = scales().xAxisDomain;
    expect(
      markerX([
        { time: new Date('2025-12-25T00:00:00Z') },
        { time: new Date('2026-06-01T00:00:00Z') },
      ]),
    ).toEqual([start, end]);
  });
});
