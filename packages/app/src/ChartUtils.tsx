import { useMemo } from 'react';
import { add, differenceInSeconds } from 'date-fns';
import { omit } from 'lodash';
import SqlString from 'sqlstring';
import { z } from 'zod';
import {
  ColumnMetaType,
  filterColumnMetaByType,
  inferTimestampColumn,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { isMetricChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { getAlignedDateRange } from '@hyperdx/common-utils/dist/core/utils';
import {
  convertDateRangeToGranularityString,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  AggregateFunction as AggFnV2,
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  ChartConfigWithOptTimestamp,
  DisplayType,
  Filter,
  MetricsDataType as MetricsDataTypeV2,
  SavedChartConfig,
  SourceKind,
  SQLInterval,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { SegmentedControl } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import DateRangeIndicator from './components/charts/DateRangeIndicator';
import { MVOptimizationExplanationResult } from './hooks/useMVOptimizationExplanation';
import { getMetricNameSql } from './otelSemanticConventions';
import {
  AggFn,
  ChartSeries,
  MetricsDataType,
  SourceTable,
  TableChartSeries,
  TimeChartSeries,
} from './types';
import { NumberFormat } from './types';
import { getColorProps, getLogLevelColorOrder, logLevelColor } from './utils';

export const SORT_ORDER = [
  { value: 'asc' as const, label: 'Ascending' },
  { value: 'desc' as const, label: 'Descending' },
];

export type SortOrder = (typeof SORT_ORDER)[number]['value'];

export const TABLES = [
  { value: 'logs' as const, label: 'Logs / Spans' },
  { value: 'metrics' as const, label: 'Metrics' },
];

export const AGG_FNS = [
  { value: 'count' as const, label: 'Count of Events', isAttributable: false },
  { value: 'sum' as const, label: 'Sum', isAttributable: false },
  { value: 'p99' as const, label: '99th Percentile' },
  { value: 'p95' as const, label: '95th Percentile' },
  { value: 'p90' as const, label: '90th Percentile' },
  { value: 'p50' as const, label: 'Median' },
  { value: 'avg' as const, label: 'Average' },
  { value: 'max' as const, label: 'Maximum' },
  { value: 'min' as const, label: 'Minimum' },
  {
    value: 'count_distinct' as const,
    label: 'Count Distinct',
    isAttributable: false,
  },
  { value: 'any' as const, label: 'Any' },
  { value: 'none' as const, label: 'Custom' },
];

export const getMetricAggFns = (
  dataType: MetricsDataType,
): { value: AggFn; label: string }[] => {
  if (dataType === MetricsDataType.Histogram) {
    return [
      { value: 'p99', label: '99th Percentile' },
      { value: 'p95', label: '95th Percentile' },
      { value: 'p90', label: '90th Percentile' },
      { value: 'p50', label: 'Median' },
    ];
  } else if (dataType === MetricsDataType.Summary) {
    return [
      { value: 'sum', label: 'Sum' },
      { value: 'max', label: 'Maximum' },
      { value: 'min', label: 'Minimum' },
      { value: 'count', label: 'Sample Count' },
    ];
  }

  return [
    { value: 'sum', label: 'Sum' },
    { value: 'p99', label: '99th Percentile' },
    { value: 'p95', label: '95th Percentile' },
    { value: 'p90', label: '90th Percentile' },
    { value: 'p50', label: 'Median' },
    { value: 'avg', label: 'Average' },
    { value: 'max', label: 'Maximum' },
    { value: 'min', label: 'Minimum' },
  ];
};

export const DEFAULT_CHART_CONFIG: Omit<
  SavedChartConfig,
  'source' | 'connection'
> = {
  name: '',
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: '',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  displayType: DisplayType.Line,
  granularity: 'auto',
  alignDateRangeToGranularity: true,
};

export const isGranularity = (value: string): value is Granularity => {
  return Object.values(Granularity).includes(value as Granularity);
};

export function convertToTimeChartConfig(config: ChartConfigWithDateRange) {
  const granularity =
    config.granularity === 'auto' || config.granularity == null
      ? convertDateRangeToGranularityString(config.dateRange, 80)
      : config.granularity;

  const dateRange =
    config.alignDateRangeToGranularity === false
      ? config.dateRange
      : getAlignedDateRange(config.dateRange, granularity);

  return {
    ...config,
    dateRange,
    dateRangeEndInclusive: false,
    granularity,
    limit: { limit: 100000 },
  };
}

export function useTimeChartSettings(chartConfig: ChartConfigWithDateRange) {
  return useMemo(() => {
    const convertedConfig = convertToTimeChartConfig(chartConfig);

    return {
      displayType: convertedConfig.displayType,
      dateRange: convertedConfig.dateRange,
      fillNulls: convertedConfig.fillNulls,
      granularity: convertedConfig.granularity,
    };
  }, [chartConfig]);
}

export function seriesToSearchQuery({
  series,
  groupByValue,
}: {
  series: ChartSeries[];
  groupByValue?: string;
}) {
  const queries = series
    .map((s, i) => {
      if (s.type === 'time' || s.type === 'table' || s.type === 'number') {
        const { where, aggFn, field } = s;
        return `${where.trim()}${
          aggFn !== 'count' && field ? ` ${field}:*` : ''
        }${
          'groupBy' in s && s.groupBy != null && s.groupBy.length > 0
            ? ` ${s.groupBy}:${groupByValue ?? '*'}`
            : ''
        }`.trim();
      }
    })
    .filter(q => q != null && q.length > 0);

  const q =
    queries.length > 1
      ? queries.map(q => `(${q})`).join(' OR ')
      : queries.join('');

  return q;
}

export function seriesToUrlSearchQueryParam({
  series,
  dateRange,
  groupByValue = '*',
}: {
  series: ChartSeries[];
  dateRange: [Date, Date];
  groupByValue?: string | undefined;
}) {
  const q = seriesToSearchQuery({ series, groupByValue });

  return new URLSearchParams({
    q,
    from: `${dateRange[0].getTime()}`,
    to: `${dateRange[1].getTime()}`,
  });
}

export function TableToggle({
  table,
  setTableAndAggFn,
}: {
  setTableAndAggFn: (table: SourceTable, fn: AggFn) => void;
  table: string;
}) {
  return (
    <SegmentedControl
      value={table}
      onChange={(value: string) => {
        const val = value ?? 'logs';
        if (val === 'logs') {
          setTableAndAggFn('logs', 'count');
        } else if (val === 'metrics') {
          // TODO: This should set rate if metric field is a sum
          // or we should just reset the field if changing tables
          setTableAndAggFn('metrics', 'max');
        }
      }}
      data={[
        { label: 'Logs/Spans', value: 'logs' },
        { label: 'Metrics', value: 'metrics' },
      ]}
    />
  );
}

export const ChartKeyJoiner = ' · ';
export const PreviousPeriodSuffix = ' (previous)';

export function convertGranularityToSeconds(granularity: SQLInterval): number {
  const [num, unit] = granularity.split(' ');
  const numInt = Number.parseInt(num);
  switch (unit) {
    case 'second':
      return numInt;
    case 'minute':
      return numInt * 60;
    case 'hour':
      return numInt * 60 * 60;
    case 'day':
      return numInt * 60 * 60 * 24;
    default:
      return 0;
  }
}

// Note: roundToNearestMinutes is broken in date-fns currently
// additionally it doesn't support seconds or > 30min
// so we need to write our own :(
// see: https://github.com/date-fns/date-fns/pull/3267/files
export function toStartOfInterval(date: Date, granularity: SQLInterval): Date {
  const [num, unit] = granularity.split(' ');
  const numInt = Number.parseInt(num);
  const roundFn = Math.floor;

  switch (unit) {
    case 'second':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          date.getUTCMinutes(),
          roundFn(date.getUTCSeconds() / numInt) * numInt,
        ),
      );
    case 'minute':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          roundFn(date.getUTCMinutes() / numInt) * numInt,
        ),
      );
    case 'hour':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          roundFn(date.getUTCHours() / numInt) * numInt,
        ),
      );
    case 'day': {
      // Clickhouse uses the # of days since unix epoch to round dates
      // see: https://github.com/ClickHouse/ClickHouse/blob/master/src/Common/DateLUTImpl.h#L1059
      const daysSinceEpoch = date.getTime() / 1000 / 60 / 60 / 24;
      const daysSinceEpochRounded = roundFn(daysSinceEpoch / numInt) * numInt;

      return new Date(daysSinceEpochRounded * 1000 * 60 * 60 * 24);
    }
    default:
      return date;
  }
}

export function timeBucketByGranularity(
  start: Date,
  end: Date,
  granularity: SQLInterval,
): Date[] {
  const buckets: Date[] = [];

  let current = toStartOfInterval(start, granularity);
  const granularitySeconds = convertGranularityToSeconds(granularity);
  while (current < end) {
    buckets.push(current);
    current = add(current, {
      seconds: granularitySeconds,
    });
  }

  return buckets;
}

export const isAggregateFunction = (value: string) => {
  const fns = [
    // Basic aggregates
    'count',
    'countIf',
    'countDistinct',
    'sum',
    'sumIf',
    'avg',
    'avgIf',
    'min',
    'max',
    'any',
    'anyLast',
    'groupArray',
    'groupArrayInsertAt',
    'groupArrayMovingAvg',
    'groupArraySample',
    'groupUniqArray',
    'groupUniqArrayIf',
    'groupArrayIntersect',
    'groupArrayIntersectIf',
    'groupArrayReduce',
    'groupBitmap',
    'groupBitmapIf',
    'groupBitmapOr',
    'groupBitmapXor',

    // Quantiles
    'quantile',
    'quantileIf',
    'quantileExact',
    'quantileExactWeighted',
    'quantileTiming',
    'quantileTimingWeighted',
    'quantileTDigest',
    'quantileTDigestWeighted',
    'quantileBFloat16',
    'quantileBFloat16Weighted',
    'quantiles',
    'median',
    'medianExact',
    'medianTDigest',
    'medianBFloat16',

    // Statistical functions
    'stddevPop',
    'stddevPopIf',
    'stddevSamp',
    'stddevSampIf',
    'varPop',
    'varPopIf',
    'varSamp',
    'varSampIf',
    'covarPop',
    'covarSamp',
    'corr',

    // Combinators
    'uniq',
    'uniqExact',
    'uniqCombined',
    'uniqCombined64',
    'uniqHLL12',
    'uniqTheta',

    // Bit operations
    'groupBitAnd',
    'groupBitOr',
    'groupBitXor',

    // Map and tuple
    'groupArrayMap',
    'groupArrayTuple',
    'groupArraySorted',
    'topK',
    'topKIf',
    'topKWeighted',

    // Aggregate combinators
    'argMin',
    'argMax',
    'minMap',
    'maxMap',

    // Specialized aggregates
    'runningDifference',
    'retention',
    'sequenceCount',
    'sequenceMatch',
    'histogram',
    'simpleLinearRegression',
    'stochasticLinearRegression',
    'categoricalInformationValue',
    'sumMap',
    'sumMapFiltered',
    'sumWithOverflow',
    'entropy',
    'skewPop',
    'skewSamp',
    'kurtPop',
    'kurtSamp',
  ];

  // Make case-insensitive since ClickHouse function names are case-insensitive
  const lowerValue = value.toLowerCase();
  return fns.some(fn => lowerValue.includes(fn.toLowerCase() + '('));
};

export const INTEGER_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number',
  mantissa: 0,
  thousandSeparated: true,
};

export const SINGLE_DECIMAL_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number',
  mantissa: 1,
  thousandSeparated: true,
};

export const MS_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number',
  mantissa: 2,
  thousandSeparated: true,
  unit: 'ms',
};

export const ERROR_RATE_PERCENTAGE_NUMBER_FORMAT: NumberFormat = {
  output: 'percent',
  mantissa: 0,
};

export const K8S_CPU_PERCENTAGE_NUMBER_FORMAT: NumberFormat = {
  output: 'percent',
  mantissa: 0,
};

export const K8S_FILESYSTEM_NUMBER_FORMAT: NumberFormat = {
  output: 'byte',
};

export const K8S_MEM_NUMBER_FORMAT: NumberFormat = {
  output: 'byte',
};

export const K8S_NETWORK_NUMBER_FORMAT: NumberFormat = {
  output: 'byte',
};

function inferValueColumns(
  meta: Array<{ name: string; type: string }>,
  excluded: Set<string>,
) {
  return filterColumnMetaByType(meta, [JSDataType.Number])?.filter(
    c => !excluded.has(c.name),
  );
}

function inferGroupColumns(meta: Array<{ name: string; type: string }>) {
  return filterColumnMetaByType(meta, [
    JSDataType.String,
    JSDataType.Map,
    JSDataType.Array,
  ]);
}

export function formatResponseForPieChart(
  data: ResponseJSON<Record<string, unknown>>,
  getColor: (index: number, label: string) => string,
): Array<{ label: string; value: number; color: string }> {
  if (!data.meta || data.data.length === 0) return [];

  const valueColumns = inferValueColumns(data.meta, new Set());
  const groupByColumns = inferGroupColumns(data.meta);
  if (!valueColumns?.length) return [];
  const valueColumn = valueColumns[0].name;

  return (
    data.data
      .map(row => {
        const label = groupByColumns?.length
          ? groupByColumns.map(({ name }) => row[name]).join(' - ')
          : valueColumn;
        const rawValue = row[valueColumn];
        const value =
          typeof rawValue === 'number'
            ? rawValue
            : Number.parseFloat(`${rawValue}`);
        return { label, value };
      })
      .filter(entry => !isNaN(entry.value) && isFinite(entry.value))
      // Sort in descending order so the largest slice is always first and gets the first color in the palette
      .sort((a, b) => b.value - a.value)
      .map((entry, index) => ({
        ...entry,
        color: getColor(index, entry.label),
      }))
  );
}

export function getPreviousDateRange(currentRange: [Date, Date]): [Date, Date] {
  const [start, end] = currentRange;
  const offsetSeconds = differenceInSeconds(end, start);
  return [
    new Date(start.getTime() - offsetSeconds * 1000),
    new Date(end.getTime() - offsetSeconds * 1000),
  ];
}

export interface LineData {
  dataKey: string;
  currentPeriodKey: string;
  previousPeriodKey: string;
  displayName: string;
  color: string;
  isDashed?: boolean;
}

interface LineDataWithOptionalColor extends Omit<LineData, 'color'> {
  color?: string;
}

function setLineColors(
  sortedLineData: LineDataWithOptionalColor[],
): LineData[] {
  // Ensure that the current and previous period lines are the same color
  const lineColorByCurrentPeriodKey = new Map<string, string>();

  let colorIndex = 0;
  return sortedLineData.map(line => {
    const currentPeriodKey = line.currentPeriodKey;
    if (lineColorByCurrentPeriodKey.has(currentPeriodKey)) {
      line.color = lineColorByCurrentPeriodKey.get(currentPeriodKey);
    } else if (!line.color) {
      line.color = getColorProps(
        colorIndex++,
        line.displayName ?? line.dataKey,
      );
      lineColorByCurrentPeriodKey.set(currentPeriodKey, line.color);
    } else {
      lineColorByCurrentPeriodKey.set(currentPeriodKey, line.color);
    }

    return line as LineData;
  });
}

function firstGroupColumnIsLogLevel(
  source: TSource | undefined,
  groupColumns: ColumnMetaType[],
) {
  return (
    source &&
    groupColumns.length === 1 &&
    groupColumns[0].name ===
      (source.kind === SourceKind.Log
        ? source.severityTextExpression
        : source.statusCodeExpression)
  );
}

function addResponseToFormattedData({
  response,
  lineDataMap,
  tsBucketMap,
  source,
  previousPeriodOffsetSeconds,
  isPreviousPeriod,
  hiddenSeries = [],
}: {
  tsBucketMap: Map<number, Record<string, any>>;
  lineDataMap: { [keyName: string]: LineDataWithOptionalColor };
  response: ResponseJSON<Record<string, any>>;
  source?: TSource;
  isPreviousPeriod: boolean;
  previousPeriodOffsetSeconds: number;
  hiddenSeries?: string[];
}) {
  const { meta, data } = response;
  if (meta == null) {
    throw new Error('No meta data found in response');
  }

  const timestampColumn = inferTimestampColumn(meta);
  if (timestampColumn == null) {
    throw new Error(
      `No timestamp column found with meta: ${JSON.stringify(meta)}`,
    );
  }

  const valueColumns = inferValueColumns(meta, new Set(hiddenSeries)) ?? [];
  const groupColumns = inferGroupColumns(meta) ?? [];
  const isSingleValueColumn = valueColumns.length === 1;
  const hasGroupColumns = groupColumns.length > 0;

  for (const row of data) {
    const date = new Date(row[timestampColumn.name]);

    // Previous period data needs to be shifted forward to align with current period
    const offsetSeconds = isPreviousPeriod ? previousPeriodOffsetSeconds : 0;
    const ts = Math.round(date.getTime() / 1000 + offsetSeconds);

    for (const valueColumn of valueColumns) {
      let tsBucket = tsBucketMap.get(ts);
      if (tsBucket == null) {
        tsBucket = { [timestampColumn.name]: ts };
        tsBucketMap.set(ts, tsBucket);
      }

      const currentPeriodKey = [
        // Simplify the display name if there's only one series and a group by
        ...(isSingleValueColumn && hasGroupColumns ? [] : [valueColumn.name]),
        ...groupColumns.map(g => row[g.name]),
      ].join(ChartKeyJoiner);
      const previousPeriodKey = `${currentPeriodKey}${PreviousPeriodSuffix}`;
      const keyName = isPreviousPeriod ? previousPeriodKey : currentPeriodKey;

      // UInt64 are returned as strings, we'll convert to number
      // and accept a bit of floating point error
      const rawValue = row[valueColumn.name];
      const value =
        typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue);

      // Mutate the existing bucket object to avoid repeated large object copies
      tsBucket[keyName] = value;

      // Special handling for log level / trace severity colors
      let color: string | undefined = undefined;
      if (firstGroupColumnIsLogLevel(source, groupColumns)) {
        color = logLevelColor(row[groupColumns[0].name]);
      }

      lineDataMap[keyName] = {
        dataKey: keyName,
        currentPeriodKey,
        previousPeriodKey,
        displayName: keyName,
        color,
        isDashed: isPreviousPeriod,
      };
    }
  }
}

// Input: { ts, value1, value2, groupBy1, groupBy2 },
// Output: { ts, [value1Name, groupBy1, groupBy2]: value1, [...]: value2 }
export function formatResponseForTimeChart({
  currentPeriodResponse,
  previousPeriodResponse,
  dateRange,
  granularity,
  generateEmptyBuckets = true,
  source,
  hiddenSeries = [],
  previousPeriodOffsetSeconds = 0,
}: {
  dateRange: [Date, Date];
  granularity?: SQLInterval;
  currentPeriodResponse: ResponseJSON<Record<string, any>>;
  previousPeriodResponse?: ResponseJSON<Record<string, any>>;
  generateEmptyBuckets?: boolean;
  source?: TSource;
  hiddenSeries?: string[];
  previousPeriodOffsetSeconds?: number;
}) {
  const meta = currentPeriodResponse.meta;

  if (meta == null) {
    throw new Error('No meta data found in response');
  }

  const timestampColumn = inferTimestampColumn(meta);
  const valueColumns = inferValueColumns(meta, new Set(hiddenSeries)) ?? [];
  const groupColumns = inferGroupColumns(meta) ?? [];
  const isSingleValueColumn = valueColumns.length === 1;

  if (timestampColumn == null) {
    throw new Error(
      `No timestamp column found with meta: ${JSON.stringify(meta)}`,
    );
  }

  // Timestamp -> { tsCol, line1, line2, ...}
  const tsBucketMap: Map<number, Record<string, any>> = new Map();
  const lineDataMap: {
    [keyName: string]: LineDataWithOptionalColor;
  } = {};

  addResponseToFormattedData({
    response: currentPeriodResponse,
    lineDataMap,
    tsBucketMap,
    source,
    isPreviousPeriod: false,
    previousPeriodOffsetSeconds,
    hiddenSeries,
  });

  if (previousPeriodResponse != null) {
    addResponseToFormattedData({
      response: previousPeriodResponse,
      lineDataMap,
      tsBucketMap,
      source,
      isPreviousPeriod: true,
      previousPeriodOffsetSeconds,
      hiddenSeries,
    });
  }

  const logLevelColorOrder = getLogLevelColorOrder();
  const sortedLineData = Object.values(lineDataMap).sort((a, b) => {
    return (
      logLevelColorOrder.findIndex(color => color === a.color) -
      logLevelColorOrder.findIndex(color => color === b.color)
    );
  });

  if (generateEmptyBuckets && granularity != null) {
    const generatedTsBuckets = timeBucketByGranularity(
      dateRange[0],
      dateRange[1],
      granularity,
    );

    generatedTsBuckets.forEach(date => {
      const ts = date.getTime() / 1000;
      const tsBucket = tsBucketMap.get(ts);

      if (tsBucket == null) {
        const tsBucket: Record<string, any> = {
          [timestampColumn.name]: ts,
        };

        for (const line of sortedLineData) {
          tsBucket[line.dataKey] = 0;
        }

        tsBucketMap.set(ts, tsBucket);
      } else {
        for (const line of sortedLineData) {
          if (tsBucket[line.dataKey] == null) {
            tsBucket[line.dataKey] = 0;
          }
        }
        tsBucketMap.set(ts, tsBucket);
      }
    });
  }

  // Sort results again by timestamp
  const graphResults: {
    [key: string]: number | undefined;
  }[] = Array.from(tsBucketMap.values()).sort(
    (a, b) => a[timestampColumn.name] - b[timestampColumn.name],
  );

  const sortedLineDataWithColors = setLineColors(sortedLineData);

  return {
    graphResults,
    timestampColumn,
    lineData: sortedLineDataWithColors,
    groupColumns: groupColumns.map(g => g.name),
    valueColumns: valueColumns.map(v => v.name),
    isSingleValueColumn,
  };
}

// Define a mapping from app AggFn to common-utils AggregateFunction
export const mapV1AggFnToV2 = (aggFn?: AggFn): AggFnV2 | undefined => {
  if (aggFn == null) {
    return aggFn;
  }
  // Map rate-based aggregations to their base aggregation
  if (aggFn.endsWith('_rate')) {
    return mapV1AggFnToV2(aggFn.replace('_rate', '') as AggFn);
  }

  // Map percentiles to quantile
  if (
    aggFn === 'p50' ||
    aggFn === 'p90' ||
    aggFn === 'p95' ||
    aggFn === 'p99'
  ) {
    return 'quantile';
  }

  // Map per-time-unit counts to count
  if (
    aggFn === 'count_per_sec' ||
    aggFn === 'count_per_min' ||
    aggFn === 'count_per_hour'
  ) {
    return 'count';
  }

  // For standard aggregations that exist in both, return as is
  if (
    [
      'avg',
      'count',
      'count_distinct',
      'last_value',
      'max',
      'min',
      'sum',
    ].includes(aggFn)
  ) {
    return aggFn as AggFnV2;
  }

  throw new Error(`Unsupported aggregation function in v2: ${aggFn}`);
};

export const convertV1GroupByToV2 = (
  metricSource: TSource,
  groupBy: string[],
): string => {
  return groupBy
    .map(g => {
      if (g.startsWith('k8s')) {
        return `${metricSource.resourceAttributesExpression}['${g}']`;
      }
      return g;
    })
    .join(',');
};

export const convertV1ChartConfigToV2 = (
  chartConfig: {
    // only support time or table series
    series: (TimeChartSeries | TableChartSeries)[];
    granularity?: Granularity;
    dateRange: [Date, Date];
    seriesReturnType: 'ratio' | 'column';
    displayType?: 'stacked_bar' | 'line';
    name?: string;
    fillNulls?: number | false;
    sortOrder?: SortOrder;
  },
  source: {
    log?: TSource;
    metric?: TSource;
    trace?: TSource;
  },
): ChartConfigWithDateRange => {
  const {
    series,
    granularity,
    dateRange,
    displayType = 'line',
    fillNulls,
  } = chartConfig;

  if (series.length < 1) {
    throw new Error('series is required');
  }

  const firstSeries = series[0];
  const convertedDisplayType =
    displayType === 'stacked_bar' ? DisplayType.StackedBar : DisplayType.Line;

  if (firstSeries.table === 'logs') {
    // TODO: this might not work properly since logs + traces are mixed in v1
    throw new Error('IMPLEMENT ME (logs)');
  } else if (firstSeries.table === 'metrics') {
    if (source.metric == null) {
      throw new Error('source.metric is required for metrics');
    }
    return {
      select: series.map(s => {
        const field = s.field ?? '';
        const [metricName, rawMetricDataType] = field
          .split(' - ')
          .map(s => s.trim());

        // Check if this metric name needs version-based SQL transformation
        const metricNameSql = getMetricNameSql(metricName);

        const metricDataType = z
          .nativeEnum(MetricsDataTypeV2)
          .parse(rawMetricDataType?.toLowerCase());
        return {
          aggFn: mapV1AggFnToV2(s.aggFn),
          metricType: metricDataType,
          valueExpression: field,
          metricName,
          metricNameSql,
          aggConditionLanguage: 'lucene',
          aggCondition: s.where,
        };
      }),
      from: source.metric?.from,
      numberFormat: firstSeries.numberFormat,
      groupBy: convertV1GroupByToV2(source.metric, firstSeries.groupBy),
      dateRange,
      connection: source.metric?.connection,
      metricTables: source.metric?.metricTables,
      timestampValueExpression: source.metric?.timestampValueExpression,
      granularity,
      where: '',
      fillNulls,
      displayType: convertedDisplayType,
    };
  }
  throw new Error(`unsupported table in v2: ${firstSeries.table}`);
};

/**
 * Build search URL for viewing events based on group-by values
 * Used by both chart clicks and table row clicks
 */
export function buildEventsSearchUrl({
  source,
  config,
  dateRange,
  groupFilters,
  valueRangeFilter,
}: {
  source: TSource;
  config: ChartConfigWithDateRange;
  dateRange: [Date, Date];
  groupFilters?: Array<{ column: string; value: any }>;
  valueRangeFilter?: { expression: string; value: number; threshold?: number };
}): string | null {
  if (!source?.id) {
    return null;
  }

  const isMetricChart = isMetricChartConfig(config);
  if (isMetricChart && source?.logSourceId == null) {
    notifications.show({
      color: 'yellow',
      message: 'No log source is associated with the selected metric source.',
    });
    return null;
  }

  let where = config.where;
  let whereLanguage = config.whereLanguage || 'lucene';
  if (
    where.length === 0 &&
    Array.isArray(config.select) &&
    config.select.length === 1
  ) {
    where = config.select[0].aggCondition ?? '';
    whereLanguage = config.select[0].aggConditionLanguage ?? 'lucene';
  }

  const additionalFilters: Filter[] = [];

  // Add group-by column filters
  if (groupFilters && groupFilters.length > 0) {
    groupFilters.forEach(({ column, value }) => {
      if (column && value != null) {
        // Can't use SQLString.escape here because the search endpoint relies on exist match for UI
        const condition = `${column} IN (${SqlString.escape(value)})`;
        additionalFilters.push({ type: 'sql', condition });
      }
    });
  }

  // Add Y-axis value range filter (±threshold) for charts
  if (valueRangeFilter) {
    const { expression, value, threshold = 0.05 } = valueRangeFilter;
    const hasAggregateFunction = isAggregateFunction(expression);

    if (!hasAggregateFunction) {
      const lowerBound = value * (1 - threshold);
      const upperBound = value * (1 + threshold);
      // Can't use SQLString.escape here because the search endpoint relies on exist match for UI
      const condition = `${expression} BETWEEN ${SqlString.escape(lowerBound)} AND ${SqlString.escape(upperBound)}`;

      additionalFilters.push({
        type: 'sql',
        condition,
      });
    }
  }

  // Get the time range
  const from = dateRange[0].getTime();
  const to = dateRange[1].getTime();

  const params: Record<string, string> = {
    source: source?.id ?? '',
    where: where,
    whereLanguage: whereLanguage,
    filters: JSON.stringify([...(config.filters ?? []), ...additionalFilters]),
    isLive: 'false',
    from: from.toString(),
    to: to.toString(),
  };

  // If its a metric chart, we don't pass the where and filters
  if (isMetricChart) {
    params.where = '';
    params.whereLanguage = 'lucene';
    params.filters = JSON.stringify([]);
    params.source = source?.logSourceId ?? '';
  }

  // Include the select parameter if provided to preserve custom columns
  // eventTableSelect is used for charts that override select (like histograms with count)
  // to preserve the original table's select expression
  if (config.eventTableSelect) {
    params.select = config.eventTableSelect;
  }

  return `/search?${new URLSearchParams(params).toString()}`;
}

/**
 * Extract group column names from chart config's groupBy field
 * Handles both string format ("col1, col2") and array format ([{ valueExpression: "col1" }, ...])
 */
function extractGroupColumns(
  groupBy: ChartConfigWithDateRange['groupBy'],
): string[] {
  if (!groupBy) return [];

  if (typeof groupBy === 'string') {
    // String GROUP BY: "col1, col2"
    return groupBy.split(',').map(v => v.trim());
  }

  // Array GROUP BY: [{ valueExpression: "col1" }, ...] or ["col1", ...]
  return groupBy.map(g => (typeof g === 'string' ? g : g.valueExpression));
}

/**
 * Build search URL from a table row click
 * Extracts group filters and value range filter from the row data
 */
export function buildTableRowSearchUrl({
  row,
  source,
  config,
  dateRange,
}: {
  row: Record<string, any>;
  source: TSource | undefined;
  config: ChartConfigWithDateRange;
  dateRange: [Date, Date];
}): string | null {
  if (!source?.id) {
    return null;
  }

  // Extract group-by column names and build filters from row values
  const groupFilters: Array<{ column: string; value: any }> = [];
  const groupColumns = extractGroupColumns(config.groupBy);

  groupColumns.forEach(col => {
    if (row[col] != null) {
      groupFilters.push({ column: col, value: row[col] });
    }
  });

  // Build value range filter from the first select column
  let valueRangeFilter: { expression: string; value: number } | undefined;

  const firstSelect = config.select?.[0];
  if (firstSelect) {
    const aggFn =
      typeof firstSelect === 'string' ? undefined : firstSelect.aggFn;
    const isAttributable =
      AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

    if (isAttributable) {
      const valueExpression =
        typeof firstSelect === 'string'
          ? firstSelect
          : firstSelect.valueExpression;

      // Extract group column names to exclude them from value columns
      const groupColumnSet = new Set(extractGroupColumns(config.groupBy));

      // Find the first value column (non-group column)
      const valueColumn = Object.keys(row).find(
        key => !groupColumnSet.has(key),
      );

      const rowValue = valueColumn ? row[valueColumn] : undefined;

      if (rowValue != null && typeof rowValue === 'number') {
        valueRangeFilter = {
          expression: valueExpression,
          value: rowValue,
        };
      }
    }
  }

  return buildEventsSearchUrl({
    source,
    config,
    dateRange,
    groupFilters,
    valueRangeFilter,
  });
}

export function convertToNumberChartConfig(
  config: ChartConfigWithDateRange,
): ChartConfigWithOptTimestamp {
  return omit(config, ['granularity', 'groupBy']);
}

export function convertToPieChartConfig(
  config: ChartConfigWithOptTimestamp,
): ChartConfigWithOptTimestamp {
  return omit(config, ['granularity']);
}

export function convertToTableChartConfig(
  config: ChartConfigWithOptTimestamp,
): ChartConfigWithOptTimestamp {
  const convertedConfig = structuredClone(omit(config, ['granularity']));

  // Set a default limit if not already set
  if (!convertedConfig.limit) {
    convertedConfig.limit = { limit: 200 };
  }

  // Set a default orderBy if groupBy is set but orderBy is not,
  // so that the set of rows within the limit is stable.
  if (
    convertedConfig.groupBy &&
    typeof convertedConfig.groupBy === 'string' &&
    !convertedConfig.orderBy
  ) {
    convertedConfig.orderBy = convertedConfig.groupBy;
  }

  return convertedConfig;
}

export function buildMVDateRangeIndicator({
  mvOptimizationData,
  originalDateRange,
}: {
  mvOptimizationData?: MVOptimizationExplanationResult;
  originalDateRange: [Date, Date];
}) {
  const mvDateRange = mvOptimizationData?.optimizedConfig?.dateRange;
  if (!mvDateRange) return null;

  const mvGranularity = mvOptimizationData?.explanations.find(e => e.success)
    ?.mvConfig.minGranularity;

  return (
    <DateRangeIndicator
      key="date-range-indicator"
      originalDateRange={originalDateRange}
      effectiveDateRange={mvDateRange}
      mvGranularity={mvGranularity}
    />
  );
}

export function shouldFillNullsWithZero(
  fillNulls: ChartConfigWithOptDateRange['fillNulls'],
): boolean {
  // To match legacy behavior, fill nulls with 0 unless explicitly disabled
  return fillNulls !== false;
}
