import { useMemo } from 'react';
import { add, isSameSecond, sub } from 'date-fns';
import { AxisDomain } from 'recharts/types/util/types';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import {
  getSeriesColorForGroup,
  type LineData,
  toStartOfInterval,
} from '@/ChartUtils';
import {
  ChartAnnotation,
  getAnnotationElements,
  layoutAnnotations,
  resolveAnnotationSeries,
} from '@/components/charts/chartAnnotations';
import { computeExemplarYBounds } from '@/components/Exemplars';
import type { NumberFormat } from '@/types';

import {
  cleanNumber,
  formatAxisTick,
  getExpandableYAxisTicks,
  getNiceYAxisTicks,
  getYAxisTicks,
} from './axisTicks';
import { hasSeriesSelection } from './chartData';
import { Y_AXIS_WIDTH } from './constants';

type UseChartScalesArgs = {
  annotations: ChartAnnotation[] | undefined;
  /** Measured container width; annotation layout needs the drawable width. */
  containerWidth: number;
  dateRange: readonly [Date, Date];
  granularity: string;
  dateRangeEndInclusive: boolean;
  displayType: DisplayType;
  fitYAxisToData: boolean | undefined;
  graphResults: Record<string, unknown>[];
  lineData: LineData[];
  visibleLineData: LineData[];
  selectedSeriesNames: Set<string> | undefined;
  referenceLineValues: number[];
  axisNumberFormat: NumberFormat | undefined;
  /**
   * Whether any exemplar marker could draw. visibleSeriesMax exists only to give
   * the exemplar clamp an upper bound, and computing it is an O(rows x series)
   * pass — which every time chart in the app was paying even with the overlay
   * switched off for the whole deployment.
   */
  hasExemplars: boolean;
};

// Shared by every yAxisDomain branch below. Callers pass only the series
// actually drawn (already selection- and HARD_LINES_LIMIT-filtered).
export function scanYAxisValueRange(
  graphResults: any[],
  lineData: LineData[],
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  graphResults.forEach(dataPoint => {
    lineData.forEach(ld => {
      const value = dataPoint[ld.dataKey];
      if (typeof value === 'number' && !isNaN(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
  });
  return { min, max };
}

export interface YAxisBounds {
  domain: AxisDomain;
  ticks: number[] | undefined;
  tickFormatter?: (value: number) => string;
}

const DEFAULT_Y_AXIS_BOUNDS: YAxisBounds = {
  domain: [0, 'auto'],
  ticks: undefined,
};
const FIT_Y_AXIS_BOUNDS: YAxisBounds = {
  domain: ['auto', 'auto'],
  ticks: undefined,
};

// A stacked bar's rendered height sums its series at each timestamp - leave
// that entirely to Recharts, regardless of selection/fit-to-data state.
export function computeYAxisBounds(
  graphResults: any[],
  visibleLineData: LineData[],
  hasSelection: boolean,
  fitYAxisToData: boolean,
  displayType: DisplayType,
  referenceLineValues: number[],
  axisNumberFormat?: NumberFormat,
): YAxisBounds {
  if (displayType === DisplayType.StackedBar) {
    return DEFAULT_Y_AXIS_BOUNDS;
  }
  const shouldFitYAxis = fitYAxisToData;

  if (!hasSelection && !shouldFitYAxis) {
    // A fully numeric domain skips Recharts' own nice rounding, and a
    // reference line can extend it further - defer to Recharts entirely.
    if (referenceLineValues.length > 0) {
      return DEFAULT_Y_AXIS_BOUNDS;
    }
    const { min, max } = scanYAxisValueRange(graphResults, visibleLineData);
    if (max === -Infinity) {
      return DEFAULT_Y_AXIS_BOUNDS;
    }
    // Recharts widens an explicit domain to fit out-of-range data, so
    // negative data must be reflected here, not just pinned at zero.
    const lowerBound = cleanNumber(Math.min(0, min));
    // max * 1.05 would shrink the upper bound below max for negative data;
    // padding away from zero keeps headroom regardless of max's sign.
    const upperBound = cleanNumber(max + Math.abs(max) * 0.05);
    if (upperBound <= lowerBound) {
      return DEFAULT_Y_AXIS_BOUNDS;
    }
    const expanded = getExpandableYAxisTicks(
      lowerBound,
      upperBound,
      5,
      axisNumberFormat,
    );
    // No nice step fits - fall back to getYAxisTicks' reduce-tick-count
    // dedup instead of Recharts' raw, collision-prone default.
    if (expanded.ticks.length === 0) {
      const baseFormat = (value: number) =>
        formatAxisTick(value, axisNumberFormat);
      return {
        domain: [lowerBound, upperBound],
        ticks: getYAxisTicks(lowerBound, upperBound, baseFormat),
        tickFormatter: baseFormat,
      };
    }
    return {
      domain: [lowerBound, expanded.max],
      ticks: expanded.ticks,
      tickFormatter: expanded.tickFormatter,
    };
  }

  // A selection with fit-to-data off still keeps the zero-pinned fallback,
  // not the unpinned fit fallback - only fitting itself opts out of it.
  const degenerateFallback = shouldFitYAxis
    ? FIT_Y_AXIS_BOUNDS
    : DEFAULT_Y_AXIS_BOUNDS;
  const { min, max } = scanYAxisValueRange(graphResults, visibleLineData);
  if (min === Infinity || max === -Infinity) {
    return degenerateFallback;
  }
  const padding = (max - min) * 0.05;
  // Recharts widens the domain to actual negative data regardless of fit
  // mode, so the lower bound must follow it whenever min itself is negative.
  const lowerBound = cleanNumber(
    min < 0 ? min - padding : Math.max(0, min - padding),
  );
  const upperBound = cleanNumber(max + padding);
  if (upperBound <= lowerBound) {
    return degenerateFallback;
  }
  // A reference line can widen the domain (extendDomain) - extend it up
  // front and nice-step the result, instead of ticking a stale domain.
  if (referenceLineValues.length > 0) {
    const extendedLower = cleanNumber(
      Math.min(lowerBound, ...referenceLineValues),
    );
    const extendedUpper = cleanNumber(
      Math.max(upperBound, ...referenceLineValues),
    );
    const expanded = getExpandableYAxisTicks(
      extendedLower,
      extendedUpper,
      5,
      axisNumberFormat,
    );
    if (expanded.ticks.length > 0) {
      return {
        domain: [extendedLower, expanded.max],
        ticks: expanded.ticks,
        tickFormatter: expanded.tickFormatter,
      };
    }
    const baseFormat = (value: number) =>
      formatAxisTick(value, axisNumberFormat);
    return {
      domain: [extendedLower, extendedUpper],
      ticks: getYAxisTicks(extendedLower, extendedUpper, baseFormat),
      tickFormatter: baseFormat,
    };
  }
  const { ticks, tickFormatter } = getNiceYAxisTicks(
    lowerBound,
    upperBound,
    5,
    axisNumberFormat,
  );
  // Same fallback as the default branch above - reduce tick count via
  // getYAxisTicks rather than leaving this to Recharts' raw default.
  if (ticks.length === 0) {
    const baseFormat = (value: number) =>
      formatAxisTick(value, axisNumberFormat);
    return {
      domain: [lowerBound, upperBound],
      ticks: getYAxisTicks(lowerBound, upperBound, baseFormat),
      tickFormatter: baseFormat,
    };
  }
  return {
    domain: [lowerBound, upperBound],
    ticks,
    tickFormatter,
  };
}

/**
 * Derive the chart's axis domains, the exemplar clamp range, and the annotation
 * elements that hang off the x-domain.
 *
 * Extracted from MemoChart because it is pure derivation from props — no state,
 * no event handlers, no recharts tree — and because the interaction between the
 * y-domain and the exemplar clamp is subtle enough (an outlier marker must not be
 * allowed to stretch the axis and crush the series flat) that it reads better
 * with the three memos adjacent and alone.
 */
export function useChartScales({
  annotations,
  containerWidth,
  dateRange,
  granularity,
  dateRangeEndInclusive,
  displayType,
  fitYAxisToData,
  graphResults,
  lineData,
  visibleLineData,
  selectedSeriesNames,
  referenceLineValues,
  axisNumberFormat,
  hasExemplars,
}: UseChartScalesArgs) {
  // Max value across the visible series. Used as the exemplar clamp's upper
  // bound when the y-axis domain is 'auto', so a single slow-trace outlier (which
  // can be 100x the p99 line) can't stretch the axis and crush the series flat —
  // the marker pins to the top of the series range while its hover card still
  // shows the true duration. See computeExemplarYBounds.
  const visibleSeriesMax = useMemo(() => {
    if (!hasExemplars) return 0;
    const hasSelection = selectedSeriesNames && selectedSeriesNames.size > 0;
    let max = -Infinity;
    graphResults.forEach(dataPoint => {
      lineData.forEach(ld => {
        const seriesName = ld.displayName || ld.dataKey;
        if (!hasSelection || selectedSeriesNames.has(seriesName)) {
          const value = dataPoint[ld.dataKey];
          if (typeof value === 'number' && !isNaN(value)) {
            max = Math.max(max, value);
          }
        }
      });
    });
    return max;
  }, [hasExemplars, graphResults, lineData, selectedSeriesNames]);

  const yAxisBounds = useMemo(
    () =>
      computeYAxisBounds(
        graphResults,
        visibleLineData,
        hasSeriesSelection(selectedSeriesNames),
        fitYAxisToData ?? false,
        displayType,
        referenceLineValues,
        axisNumberFormat,
      ),
    [
      graphResults,
      visibleLineData,
      selectedSeriesNames,
      fitYAxisToData,
      displayType,
      referenceLineValues,
      axisNumberFormat,
    ],
  );

  // Bounds an exemplar marker is clamped into before rendering, derived from the
  // domain the y-axis actually renders — see computeExemplarYBounds for why an
  // unclamped marker can silently vanish.
  const exemplarYBounds = useMemo(
    () => computeExemplarYBounds(yAxisBounds.domain, visibleSeriesMax),
    [yAxisBounds.domain, visibleSeriesMax],
  );

  // Typed as the tuple it actually returns rather than the wider AxisDomain, so
  // the consumers below (annotation + exemplar clamping) can read [min, max]
  // without asserting. Still assignable to XAxis's `domain`.
  const xAxisDomain: [number, number] = useMemo(() => {
    let startTime = toStartOfInterval(dateRange[0], granularity);
    let endTime = toStartOfInterval(dateRange[1], granularity);
    const endTimeIsBoundaryAligned = isSameSecond(dateRange[1], endTime);
    if (endTimeIsBoundaryAligned && !dateRangeEndInclusive) {
      endTime = sub(endTime, {
        seconds: convertGranularityToSeconds(granularity),
      });
    }

    // For bar charts, extend the domain in both directions by half a granularity unit
    // so that the full bar width is within the bounds of the chart
    if (displayType === DisplayType.StackedBar) {
      const halfGranularitySeconds =
        convertGranularityToSeconds(granularity) / 2;
      startTime = sub(startTime, { seconds: halfGranularitySeconds });
      endTime = add(endTime, { seconds: halfGranularitySeconds });
    }

    return [startTime.getTime() / 1000, endTime.getTime() / 1000];
  }, [dateRange, granularity, dateRangeEndInclusive, displayType]);

  // Tint each marker to match the series it describes and drop the ones that
  // can't be tied to anything on this chart — see `resolveAnnotationSeries`.
  const coloredAnnotations = useMemo(() => {
    if (!annotations?.length) {
      return annotations;
    }
    return resolveAnnotationSeries(annotations, group =>
      getSeriesColorForGroup(lineData, group),
    );
  }, [annotations, lineData]);

  // Same geometry the hit layer positions against, so the hover bands can't
  // drift from the lines they belong to.
  const laidOutAnnotations = useMemo(() => {
    if (!coloredAnnotations?.length) {
      return null;
    }
    return layoutAnnotations(coloredAnnotations, {
      domain: xAxisDomain,
      plotWidth: Math.max(0, containerWidth - Y_AXIS_WIDTH),
    });
  }, [coloredAnnotations, xAxisDomain, containerWidth]);

  // Alert/event markers as dashed lines, clamped to the chart's x-axis domain so
  // an edge marker (e.g. an alert already firing at window open) stays visible
  // instead of being dropped. Labels float in the reserved top headroom.
  const annotationElements = useMemo(() => {
    if (!coloredAnnotations?.length) {
      return null;
    }
    return getAnnotationElements(coloredAnnotations, {
      domain: xAxisDomain,
      // Drawable width, so markers too close together share one label. Zero on
      // the first paint (before ResponsiveContainer measures), which the
      // renderer treats as "label everything".
      plotWidth: Math.max(0, containerWidth - Y_AXIS_WIDTH),
    });
  }, [coloredAnnotations, xAxisDomain, containerWidth]);

  return {
    yAxisBounds,
    exemplarYBounds,
    xAxisDomain,
    annotationElements,
    laidOutAnnotations,
  };
}
