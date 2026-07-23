import { useCallback, useMemo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import { Select, Text } from '@mantine/core';

import { AGG_FNS } from '@/ChartUtils';

type AggFnValues = (typeof AGG_FNS)[number]['value'];

type OnChangeValue =
  | { aggFn?: AggFnValues }
  | { aggFn: 'quantile'; level: number };

type MetricAggFnOption = {
  value: string;
  label: string;
  /** Semantics hint rendered under the label in the dropdown. */
  description?: string;
};

/**
 * §4 (rate-normalization prompt): the same aggregate means a different
 * statistic per metric type, so v2 metric sources get a gated, honestly
 * labeled list instead of the generic AGG_FNS. Percentile entries reuse the
 * pXX → { aggFn: 'quantile', level } mapping. Anything not listed is either
 * unsupported by the v2 translators (they throw) or a silently-wrong
 * statistic (e.g. Count on a counter).
 */
export const METRIC_V2_AGG_FN_OPTIONS: Record<
  MetricsDataType,
  MetricAggFnOption[]
> = {
  [MetricsDataType.Sum]: [
    {
      value: 'sum',
      label: 'Rate (per second)',
      description:
        'Total per-second rate across series — invariant to lookback and bucket width',
    },
    {
      value: 'increase',
      label: 'Increase (per interval)',
      description:
        'Counter increase per display bucket — scales with the bucket width',
    },
    {
      value: 'avg',
      label: 'Avg rate across series',
      description:
        'Averages per-series rates — for total throughput use Rate or Sum',
    },
    { value: 'max', label: 'Max rate across series' },
    { value: 'min', label: 'Min rate across series' },
    { value: 'p99', label: 'p99 rate across series' },
    { value: 'p95', label: 'p95 rate across series' },
    { value: 'p90', label: 'p90 rate across series' },
    { value: 'p50', label: 'Median rate across series' },
  ],
  [MetricsDataType.Gauge]: [
    { value: 'avg', label: 'Average' },
    { value: 'max', label: 'Maximum' },
    { value: 'min', label: 'Minimum' },
    { value: 'sum', label: 'Sum across series' },
    {
      value: 'p99',
      label: 'p99 across series',
      description: 'Distribution across series at each bucket — not events',
    },
    { value: 'p95', label: 'p95 across series' },
    { value: 'p90', label: 'p90 across series' },
    { value: 'p50', label: 'Median across series' },
  ],
  [MetricsDataType.Histogram]: [
    {
      value: 'p99',
      label: '99th Percentile',
      description: 'True event percentile from histogram buckets',
    },
    { value: 'p95', label: '95th Percentile' },
    { value: 'p90', label: '90th Percentile' },
    { value: 'p50', label: 'Median' },
    {
      value: 'avg',
      label: 'Average',
      description: 'Sum ÷ Count — the average event value, not a series mean',
    },
    { value: 'count', label: 'Count of Events' },
  ],
  [MetricsDataType.ExponentialHistogram]: [
    {
      value: 'p99',
      label: '99th Percentile',
      description: 'True event percentile from the exponential sketch',
    },
    { value: 'p95', label: '95th Percentile' },
    { value: 'p90', label: '90th Percentile' },
    { value: 'p50', label: 'Median' },
    { value: 'count', label: 'Count of Events' },
  ],
  [MetricsDataType.Summary]: [
    {
      value: 'p99',
      label: 'p99 (avg of per-series p99)',
      description:
        'Stored quantiles averaged across series — a trend, not a mergeable percentile',
    },
    { value: 'p95', label: 'p95 (avg of per-series p95)' },
    { value: 'p90', label: 'p90 (avg of per-series p90)' },
    { value: 'p50', label: 'p50 (avg of per-series p50)' },
    { value: 'count', label: 'Count of Events' },
  ],
};

/**
 * Sum-typed metrics branch on IsMonotonic (from the series profile — the
 * same cached lookup the query translator uses):
 * - monotonic → true counter, the Sum list above (Rate/Increase primary);
 * - updown → an UpDownCounter is a LEVEL that arrives typed as Sum (memory
 *   usage, open connections): gauge-style aggregates over the level;
 *   Rate/Increase are hidden — differencing a level produces
 *   plausible-looking noise, not data;
 * - unknown (profile unresolved or mixed) → counter treatment, explicitly
 *   labeled "(assumes counter)" — never a silent guess.
 */
export type SumMonotonicity = 'monotonic' | 'updown' | 'unknown';

const METRIC_V2_SUM_UPDOWN_AGG_FN_OPTIONS: MetricAggFnOption[] = [
  {
    value: 'avg',
    label: 'Average (level)',
    description:
      'UpDownCounter — a level, not a counter; averaged across series',
  },
  { value: 'max', label: 'Maximum (level)' },
  { value: 'min', label: 'Minimum (level)' },
  {
    value: 'sum',
    label: 'Sum across series (level)',
    description: 'Total of per-series levels — e.g. total memory in use',
  },
  { value: 'p99', label: 'p99 across series' },
  { value: 'p95', label: 'p95 across series' },
  { value: 'p90', label: 'p90 across series' },
  { value: 'p50', label: 'Median across series' },
];

const METRIC_V2_SUM_UNKNOWN_AGG_FN_OPTIONS: MetricAggFnOption[] =
  METRIC_V2_AGG_FN_OPTIONS[MetricsDataType.Sum].map(o => ({
    ...o,
    label: `${o.label} (assumes counter)`,
    description:
      o.description ??
      'Monotonicity unresolved for this metric — treated as a counter',
  }));

export function getMetricV2AggFnOptions(
  metricType: MetricsDataType,
  sumMonotonicity: SumMonotonicity = 'unknown',
): MetricAggFnOption[] {
  if (metricType === MetricsDataType.Sum) {
    return sumMonotonicity === 'monotonic'
      ? METRIC_V2_AGG_FN_OPTIONS[MetricsDataType.Sum]
      : sumMonotonicity === 'updown'
        ? METRIC_V2_SUM_UPDOWN_AGG_FN_OPTIONS
        : METRIC_V2_SUM_UNKNOWN_AGG_FN_OPTIONS;
  }
  return METRIC_V2_AGG_FN_OPTIONS[metricType];
}

/** Fallback when a stale selection is illegal for the (new) metric type. */
export function getMetricV2DefaultAggFn(
  metricType: MetricsDataType,
  sumMonotonicity: SumMonotonicity = 'unknown',
): string {
  if (metricType === MetricsDataType.Sum && sumMonotonicity === 'updown') {
    return 'avg';
  }
  return {
    [MetricsDataType.Sum]: 'sum',
    [MetricsDataType.Gauge]: 'avg',
    [MetricsDataType.Histogram]: 'p95',
    [MetricsDataType.ExponentialHistogram]: 'p95',
    [MetricsDataType.Summary]: 'p95',
  }[metricType];
}

const PERCENTILE_VALUES = ['p50', 'p90', 'p95', 'p99'];

/** UI value for a stored (aggFn, level) pair — quantiles render as pXX. */
export function aggFnToUiValue(
  aggFn: string | undefined,
  level: number | undefined,
): string | undefined {
  if (aggFn === 'quantile' && level != null) {
    return `p${Math.round(level * 100)}`;
  }
  return aggFn;
}

export function isMetricV2AggFnAllowed(
  metricType: MetricsDataType,
  aggFn: string | undefined,
  level: number | undefined,
  sumMonotonicity: SumMonotonicity = 'unknown',
): boolean {
  const options = getMetricV2AggFnOptions(metricType, sumMonotonicity);
  // Any quantile level is legal wherever percentiles are offered — a saved
  // p75 (API/legacy) must not be silently rewritten to a preset.
  if (aggFn === 'quantile') {
    return options.some(o => /^p\d+$/.test(o.value));
  }
  const ui = aggFnToUiValue(aggFn, level);
  return options.some(o => o.value === ui);
}

function AggFnSelect({
  value,
  defaultValue,
  onChange,
  hideCustom,
  metricType,
  metricsV2,
  sumMonotonicity,
}: {
  value: string;
  defaultValue: string;
  onChange: (value: OnChangeValue) => void;
  hideCustom?: boolean;
  metricType?: MetricsDataType;
  /** v2 metric source: gate + relabel per metric type (v1 keeps the generic
   * list — its sum shapes are still per-bucket, so the per-second labels
   * would lie there). */
  metricsV2?: boolean;
  /** Sum-typed metrics only: monotonicity regime from the series profile. */
  sumMonotonicity?: SumMonotonicity;
}) {
  const _onChange = useCallback(
    (value: string | null) => {
      if (value == null) {
        onChange({});
      } else if (PERCENTILE_VALUES.includes(value)) {
        onChange({
          aggFn: 'quantile',
          level: Number.parseFloat(value.replace('p', '0.')),
        });
      } else {
        // @ts-ignore
        onChange({ aggFn: value });
      }
    },
    [onChange],
  );

  const options = useMemo(() => {
    if (metricsV2 && metricType != null) {
      return getMetricV2AggFnOptions(metricType, sumMonotonicity);
    }
    let opts: MetricAggFnOption[] = hideCustom
      ? AGG_FNS.filter(fn => fn.value !== 'none')
      : AGG_FNS;
    // Only show 'increase' when the source is a Sum (counter) metric.
    if (metricType !== MetricsDataType.Sum) {
      opts = opts.filter(fn => fn.value !== 'increase');
    }
    return opts;
  }, [hideCustom, metricType, metricsV2, sumMonotonicity]);

  const descriptionByValue = useMemo(
    () =>
      new Map(
        options
          .filter(o => o.description != null)
          .map(o => [o.value, o.description as string]),
      ),
    [options],
  );

  return (
    <Select
      withScrollArea={false}
      searchable
      value={value}
      defaultValue={defaultValue}
      onChange={_onChange}
      data={options.map(({ value, label }) => ({ value, label }))}
      renderOption={({ option }) => {
        const description = descriptionByValue.get(option.value);
        return (
          <div>
            <Text size="sm">{option.label}</Text>
            {description ? (
              <Text size="xs" c="dimmed">
                {description}
              </Text>
            ) : null}
          </div>
        );
      }}
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
  metricsV2,
  sumMonotonicity,
  ...props
}: {
  defaultValue: string;
  aggFnName: string;
  quantileLevelName: string;
  hideCustom?: boolean;
  metricType?: MetricsDataType;
  metricsV2?: boolean;
  sumMonotonicity?: SumMonotonicity;
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
    },
    [onAggFnChange, onQuantileLevelChange],
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
      metricsV2={metricsV2}
      sumMonotonicity={sumMonotonicity}
    />
  );
}
