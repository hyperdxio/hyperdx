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

import { hasSeriesSelection } from './chartData';

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
 * Derive the chart's axis domains and the annotation elements that hang off the
 * x-domain.
 *
 * Extracted from MemoChart because it is pure derivation from props — no state,
 * no event handlers, no recharts tree — and the y-domain rules (fit-to-data,
 * legend selection, zero-anchored bars) are easier to follow on their own.
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
  const yAxisDomain: AxisDomain = useMemo(() => {
    const hasSelection = hasSeriesSelection(selectedSeriesNames);

    // Fitting the y-axis lower bound to the data only applies to line charts.
    // Bar charts are always anchored at zero so the bar lengths stay
    // proportional to their values.
    const shouldFitYAxis =
      fitYAxisToData && displayType !== DisplayType.StackedBar;

    // The domain follows the visible series only. With no selection and no fit,
    // let Recharts auto-scale, which pins the lower bound to 0.
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

  // Typed as the tuple it actually returns rather than the wider AxisDomain, so
  // the annotation elements below can read [min, max] without asserting. Still
  // assignable to XAxis's `domain`.
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
    yAxisDomain,
    xAxisDomain,
    annotationElements,
  };
}
