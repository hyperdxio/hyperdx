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
    // Stored event extremes (OTLP Min/Max fields). For CUMULATIVE
    // histograms these are since-start (since the last restart) — the
    // labels say so; getMetricV2AggFnOptions relabels them per-bucket when
    // the profile resolves to delta. Prometheus drops these fields at
    // remote-write, so this is a v2-only capability.
    {
      value: 'max',
      label: 'Maximum (lifetime)',
      description:
        'Stored event extreme — the max since the process started/restarted, NOT the bucket max',
    },
    {
      value: 'min',
      label: 'Minimum (lifetime)',
      description:
        'Stored event extreme — the min since the process started/restarted, NOT the bucket min',
    },
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
    {
      value: 'avg',
      label: 'Average',
      description:
        'Sum ÷ Count — the average event value, not a series mean (raw points only; long windows may be slow)',
    },
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

const PRESET_PERCENTS = [50, 90, 95, 99];

/** Formats a quantile level as its pXX label (0.999 → "p99.9"). */
export function levelToPLabel(level: number): string {
  return `p${String(+(level * 100).toFixed(2))}`;
}

/** UI option value for a quantile level: the pXX presets keep their legacy
 * values; any other stored level gets an exact `q:<level>` value so the
 * select round-trips without rounding (p99.9 must not collapse to p100). */
export function quantileLevelToOptionValue(level: number): string {
  const pct = level * 100;
  const rounded = Math.round(pct);
  if (Math.abs(pct - rounded) < 1e-6 && PRESET_PERCENTS.includes(rounded)) {
    return `p${rounded}`;
  }
  return `q:${level}`;
}

export function getMetricV2AggFnOptions(
  metricType: MetricsDataType,
  sumMonotonicity: SumMonotonicity = 'unknown',
  opts?: {
    /** Histogram profile temporality: delta extremes are true per-bucket
     * extremes, so the "(lifetime)" caveat is dropped. */
    histogramTemporality?: 'delta' | 'cumulative';
    /** Summary sources: the levels actually recorded on the series (from
     * the series table's Quantiles array). When known, the percentile
     * entries are RESTRICTED to these — requesting an unstored level would
     * silently serve the nearest stored one (§3: never silently
     * substitute). */
    summaryStoredLevels?: number[];
  },
): MetricAggFnOption[] {
  if (metricType === MetricsDataType.Sum) {
    return sumMonotonicity === 'monotonic'
      ? METRIC_V2_AGG_FN_OPTIONS[MetricsDataType.Sum]
      : sumMonotonicity === 'updown'
        ? METRIC_V2_SUM_UPDOWN_AGG_FN_OPTIONS
        : METRIC_V2_SUM_UNKNOWN_AGG_FN_OPTIONS;
  }
  if (
    metricType === MetricsDataType.Histogram &&
    opts?.histogramTemporality === 'delta'
  ) {
    return METRIC_V2_AGG_FN_OPTIONS[MetricsDataType.Histogram].map(o =>
      o.value === 'max' || o.value === 'min'
        ? {
            value: o.value,
            label: o.value === 'max' ? 'Maximum' : 'Minimum',
            description:
              'Stored event extreme — true per-bucket extreme for delta histograms',
          }
        : o,
    );
  }
  if (
    metricType === MetricsDataType.Summary &&
    opts?.summaryStoredLevels != null &&
    opts.summaryStoredLevels.length > 0
  ) {
    const levels = [...opts.summaryStoredLevels].sort((a, b) => b - a);
    return [
      ...levels.map((level, i) => ({
        value: quantileLevelToOptionValue(level),
        label: `${levelToPLabel(level)} (avg of per-series ${levelToPLabel(level)})`,
        description:
          i === 0
            ? 'Stored quantile levels only — summaries cannot serve levels they did not record'
            : undefined,
      })),
      { value: 'count', label: 'Count of Events' },
    ];
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
  histogramTemporality,
  summaryStoredLevels,
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
  /** Histogram-typed metrics: temporality from the series profile (drops
   * the "(lifetime)" extremes caveat on delta histograms). */
  histogramTemporality?: 'delta' | 'cumulative';
  /** Summary-typed metrics: recorded quantile levels — restricts the
   * percentile entries so an unstored level cannot be picked. */
  summaryStoredLevels?: number[];
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
      } else if (value.startsWith('q:')) {
        // Exact stored summary level (non-preset, e.g. 0.999).
        onChange({ aggFn: 'quantile', level: Number(value.slice(2)) });
      } else {
        // @ts-ignore
        onChange({ aggFn: value });
      }
    },
    [onChange],
  );

  const options = useMemo(() => {
    if (metricsV2 && metricType != null) {
      return getMetricV2AggFnOptions(metricType, sumMonotonicity, {
        histogramTemporality,
        summaryStoredLevels,
      });
    }
    let opts: MetricAggFnOption[] = hideCustom
      ? AGG_FNS.filter(fn => fn.value !== 'none')
      : AGG_FNS;
    // Only show 'increase' when the source is a Sum (counter) metric.
    if (metricType !== MetricsDataType.Sum) {
      opts = opts.filter(fn => fn.value !== 'increase');
    }
    return opts;
  }, [
    hideCustom,
    metricType,
    metricsV2,
    sumMonotonicity,
    histogramTemporality,
    summaryStoredLevels,
  ]);

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
  histogramTemporality,
  summaryStoredLevels,
  ...props
}: {
  defaultValue: string;
  aggFnName: string;
  quantileLevelName: string;
  hideCustom?: boolean;
  metricType?: MetricsDataType;
  metricsV2?: boolean;
  sumMonotonicity?: SumMonotonicity;
  histogramTemporality?: 'delta' | 'cumulative';
  summaryStoredLevels?: number[];
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
    if (aggFnValue === 'quantile' && quantileLevelValue != null) {
      // Presets keep their pXX values; non-preset levels round-trip as
      // exact q:<level> values (used by summary stored-level options) —
      // Math.round alone would collapse p99.9 into p100.
      return quantileLevelToOptionValue(quantileLevelValue);
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
      histogramTemporality={histogramTemporality}
      summaryStoredLevels={summaryStoredLevels}
    />
  );
}
