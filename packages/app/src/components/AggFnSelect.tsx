import { useCallback, useMemo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';

import { AGG_FNS } from '@/ChartUtils';

type AggFnValues = (typeof AGG_FNS)[number]['value'];

// aggFn form values that are supported for histogram metrics.
export const HISTOGRAM_SUPPORTED_AGG_FNS: string[] = ['count', 'quantile'];

/**
 * The aggregation to reach for when a metric is first picked, so a freshly
 * selected metric charts something meaningful instead of inheriting whatever
 * the previous series used.
 *
 * `level` is only set for quantiles: the form stores percentiles as
 * `aggFn: 'quantile'` plus a separate level (see `AggFnSelectControlled`).
 * Every value here survives the coercion effects in `ChartSeriesEditor`.
 */
export function defaultAggFnForMetricType(metricType: MetricsDataType): {
  /** Form-level aggFn, matching the `string` typing of `HISTOGRAM_SUPPORTED_AGG_FNS`. */
  aggFn: string;
  level?: number;
} {
  switch (metricType) {
    case MetricsDataType.Sum:
      return { aggFn: 'sum' };
    case MetricsDataType.Histogram:
    case MetricsDataType.ExponentialHistogram:
      // 'count' and 'quantile' are the only histogram-supported aggregations;
      // p95 is the more useful of the two as a starting point.
      return { aggFn: 'quantile', level: 0.95 };
    default:
      return { aggFn: 'avg' };
  }
}

// Displayed versions of the supported aggregation functions for histogram metrics.
const HISTOGRAM_SUPPORTED_AGG_FNS_DISPLAY: AggFnValues[] = [
  'count',
  'p99',
  'p95',
  'p90',
  'p50',
];

type OnChangeValue =
  | { aggFn?: AggFnValues }
  | { aggFn: 'quantile'; level: number };
function AggFnSelect({
  value,
  defaultValue,
  onChange,
  hideCustom,
  metricType,
}: {
  value: string;
  defaultValue: string;
  onChange: (value: OnChangeValue) => void;
  hideCustom?: boolean;
  metricType?: MetricsDataType;
}) {
  const _onChange = useCallback(
    (value: string | null) => {
      if (value == null) {
        onChange({});
      } else if (['p50', 'p90', 'p95', 'p99'].includes(value)) {
        onChange({
          aggFn: 'quantile',
          level: Number.parseFloat(value.replace('p', '0.')),
        });
      } else {
        // @ts-expect-error Mantine Select passes a string; onChange expects a narrowed AggFn union
        onChange({ aggFn: value });
      }
    },
    [onChange],
  );

  const options = useMemo(() => {
    let opts = hideCustom ? AGG_FNS.filter(fn => fn.value !== 'none') : AGG_FNS;
    // Only show 'increase' when the source is a Sum (counter) metric.
    if (metricType !== MetricsDataType.Sum) {
      opts = opts.filter(fn => fn.value !== 'increase');
    }
    // Filter out unsupported aggregation functions for histogram metrics.
    if (
      metricType === MetricsDataType.Histogram ||
      metricType === MetricsDataType.ExponentialHistogram
    ) {
      opts = opts.filter(fn =>
        HISTOGRAM_SUPPORTED_AGG_FNS_DISPLAY.includes(fn.value),
      );
    }
    return opts;
  }, [hideCustom, metricType]);

  return (
    <Select
      withScrollArea={false}
      searchable
      value={value}
      defaultValue={defaultValue}
      onChange={_onChange}
      data={options}
      data-testid="agg-fn-select"
    />
  );
}

export function AggFnSelectControlled({
  aggFnName,
  quantileLevelName,
  defaultValue,
  hideCustom,
  metricType,
  onValueChange,
  ...props
}: {
  defaultValue: string;
  aggFnName: string;
  quantileLevelName: string;
  hideCustom?: boolean;
  metricType?: MetricsDataType;
  /** Fires after the form fields are updated (Explore commits URL state). */
  onValueChange?: () => void;
} & Omit<UseControllerProps<any>, 'name'>) {
  const {
    field: { onChange: onAggFnChange, value: aggFnValue },
  } = useController({
    ...props,
    name: aggFnName,
  });

  const {
    field: { onChange: onQuantileLevelChange, value: quantileLevelValue },
  } = useController({
    ...props,
    name: quantileLevelName,
  });

  const onChange = useCallback(
    (value: OnChangeValue) => {
      if (value.aggFn === 'quantile') {
        onQuantileLevelChange(value.level);
        onAggFnChange(value.aggFn);
      } else {
        onAggFnChange(value.aggFn);
      }
      onValueChange?.();
    },
    [onAggFnChange, onQuantileLevelChange, onValueChange],
  );

  const value = useMemo(() => {
    if (aggFnValue === 'quantile') {
      return `p${Math.round(quantileLevelValue * 100)}`;
    }
    return aggFnValue;
  }, [aggFnValue, quantileLevelValue]);

  return (
    <AggFnSelect
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      hideCustom={hideCustom}
      metricType={metricType}
    />
  );
}
