import { useMemo } from 'react';
import { add, isSameSecond, sub } from 'date-fns';
import { AxisDomain } from 'recharts/types/util/types';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { type LineData, toStartOfInterval } from '@/ChartUtils';
import {
  ChartAnnotation,
  getAnnotationElements,
} from '@/components/charts/chartAnnotations';
import { computeExemplarYBounds } from '@/components/Exemplars';

type UseChartScalesArgs = {
  annotations: ChartAnnotation[] | undefined;
  dateRange: readonly [Date, Date];
  granularity: string;
  dateRangeEndInclusive: boolean;
  displayType: DisplayType;
  fitYAxisToData: boolean | undefined;
  graphResults: Record<string, unknown>[];
  lineData: LineData[];
  selectedSeriesNames: Set<string> | undefined;
};

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
  dateRange,
  granularity,
  dateRangeEndInclusive,
  displayType,
  fitYAxisToData,
  graphResults,
  lineData,
  selectedSeriesNames,
}: UseChartScalesArgs) {
  // Max value across the visible series. Used as the exemplar clamp's upper
  // bound when the y-axis domain is 'auto', so a single slow-trace outlier (which
  // can be 100x the p99 line) can't stretch the axis and crush the series flat —
  // the marker pins to the top of the series range while its hover card still
  // shows the true duration. See computeExemplarYBounds.
  const visibleSeriesMax = useMemo(() => {
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
  }, [graphResults, lineData, selectedSeriesNames]);

  const yAxisDomain: AxisDomain = useMemo(() => {
    const hasSelection = selectedSeriesNames && selectedSeriesNames.size > 0;

    // Fitting the y-axis lower bound to the data only applies to line charts.
    // Bar charts are always anchored at zero so the bar lengths stay
    // proportional to their values.
    const shouldFitYAxis =
      fitYAxisToData && displayType !== DisplayType.StackedBar;

    // The domain follows the visible series only — exemplar markers are clamped
    // to the series max at render, so they never need to widen the axis. When
    // there's no selection or fit, let Recharts auto-scale (lower pinned to 0).
    if (!hasSelection && !shouldFitYAxis) {
      return [0, 'auto'];
    }

    // Calculate domain based on visible series (all series when there's no
    // explicit selection).
    let minValue = Infinity;
    let maxValue = -Infinity;

    graphResults.forEach(dataPoint => {
      lineData.forEach(ld => {
        const seriesName = ld.displayName || ld.dataKey;
        // Only consider visible series
        if (!hasSelection || selectedSeriesNames.has(seriesName)) {
          const value = dataPoint[ld.dataKey];
          if (typeof value === 'number' && !isNaN(value)) {
            minValue = Math.min(minValue, value);
            maxValue = Math.max(maxValue, value);
          }
        }
      });
    });

    // If we found valid values, return them with some padding
    if (minValue !== Infinity && maxValue !== -Infinity) {
      const padding = (maxValue - minValue) * 0.05; // 5% padding
      // When fitting to data, allow the lower bound to follow the data
      // minimum; otherwise keep it pinned at zero. The 5% padding must not
      // drag the axis below zero unless the data itself is negative, so
      // clamp at zero whenever the minimum is non-negative.
      const lowerBound =
        shouldFitYAxis && minValue < 0
          ? minValue - padding
          : Math.max(0, minValue - padding);
      const upperBound = maxValue + padding;
      return [lowerBound, upperBound];
    }

    return ['auto', 'auto'];
  }, [
    graphResults,
    lineData,
    selectedSeriesNames,
    fitYAxisToData,
    displayType,
  ]);

  // Bounds an exemplar marker is clamped into before rendering, derived from the
  // domain the y-axis actually renders — see computeExemplarYBounds for why an
  // unclamped marker can silently vanish.
  const exemplarYBounds = useMemo(
    () => computeExemplarYBounds(yAxisDomain, visibleSeriesMax),
    [yAxisDomain, visibleSeriesMax],
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

  // Alert/event markers as dashed lines, clamped to the chart's x-axis domain so
  // an edge marker (e.g. an alert already firing at window open) stays visible
  // instead of being dropped. Labels float in the reserved top headroom.
  const annotationElements = useMemo(() => {
    if (!annotations?.length) {
      return null;
    }
    return getAnnotationElements(annotations, { domain: xAxisDomain });
  }, [annotations, xAxisDomain]);

  return {
    visibleSeriesMax,
    yAxisDomain,
    exemplarYBounds,
    xAxisDomain,
    annotationElements,
  };
}
