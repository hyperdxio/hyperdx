import { useMemo, useRef } from 'react';
import { add } from 'date-fns';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import {
  ChartConfigWithDateRange,
  DisplayType,
  SavedChartConfig,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import {
  filterColumnMetaByType,
  inferTimestampColumn,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Divider,
  Group,
  SegmentedControl,
  Select as MSelect,
} from '@mantine/core';

import { MetricNameSelect } from './components/MetricNameSelect';
import { NumberFormatInput } from './components/NumberFormat';
import api from './api';
import Checkbox from './Checkbox';
import FieldMultiSelect from './FieldMultiSelect';
import MetricTagFilterInput from './MetricTagFilterInput';
import SearchInput from './SearchInput';
import { AggFn, ChartSeries, MetricsDataType, SourceTable } from './types';
import { NumberFormat } from './types';
import { legacyMetricNameToNameAndDataType, logLevelColor } from './utils';
import { ResponseJSON } from '@clickhouse/client';

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
  { value: 'count' as const, label: 'Count of Events' },
  { value: 'sum' as const, label: 'Sum' },
  { value: 'p99' as const, label: '99th Percentile' },
  { value: 'p95' as const, label: '95th Percentile' },
  { value: 'p90' as const, label: '90th Percentile' },
  { value: 'p50' as const, label: 'Median' },
  { value: 'avg' as const, label: 'Average' },
  { value: 'max' as const, label: 'Maximum' },
  { value: 'min' as const, label: 'Minimum' },
  { value: 'count_distinct' as const, label: 'Count Distinct' },
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

export enum Granularity {
  FifteenSecond = '15 second',
  ThirtySecond = '30 second',
  OneMinute = '1 minute',
  FiveMinute = '5 minute',
  TenMinute = '10 minute',
  FifteenMinute = '15 minute',
  ThirtyMinute = '30 minute',
  OneHour = '1 hour',
  TwoHour = '2 hour',
  SixHour = '6 hour',
  TwelveHour = '12 hour',
  OneDay = '1 day',
  TwoDay = '2 day',
  SevenDay = '7 day',
  ThirtyDay = '30 day',
}

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
};

export const isGranularity = (value: string): value is Granularity => {
  return Object.values(Granularity).includes(value as Granularity);
};

export function useTimeChartSettings(chartConfig: ChartConfigWithDateRange) {
  const autoGranularity = useMemo(() => {
    return convertDateRangeToGranularityString(chartConfig.dateRange, 80);
  }, [chartConfig.dateRange]);

  const granularity =
    chartConfig.granularity === 'auto' || chartConfig.granularity == null
      ? autoGranularity
      : chartConfig.granularity;

  return {
    displayType: chartConfig.displayType,
    dateRange: chartConfig.dateRange,
    fillNulls: chartConfig.fillNulls,
    granularity,
  };
}

const seriesDisplayName = (
  s: ChartSeries | undefined,
  {
    showAggFn,
    showField,
    showWhere,
  }: {
    showAggFn?: boolean;
    showField?: boolean;
    showWhere?: boolean;
  } = {},
) => {
  if (!s) {
    return '';
  }
  if (s.type === 'time' || s.type === 'table') {
    if (s.displayName != null) {
      return s.displayName;
    }

    const displayField =
      s.aggFn !== 'count'
        ? s.table === 'metrics'
          ? s.field?.split(' - ')?.[0] ?? s.field
          : s.field
        : '';

    return `${showAggFn === false ? '' : s.aggFn}${
      showField === false ? '' : `(${displayField})`
    }${s.where && showWhere !== false ? `{${s.where}}` : ''}`;
  }
  return '';
};

export function seriesColumns({
  series,
  seriesReturnType,
}: {
  seriesReturnType: 'ratio' | 'column';
  series: ChartSeries[];
}) {
  const uniqueWhere = new Set<string | undefined>(
    series.map(s => ('where' in s ? s.where : undefined)),
  );
  const uniqueFields = new Set<string | undefined>(
    series.map(s => ('field' in s ? s.field : undefined)),
  );

  const showField = uniqueFields.size > 1;
  const showWhere = uniqueWhere.size > 1;

  const seriesMeta =
    seriesReturnType === 'ratio'
      ? [
          {
            dataKey: `series_0.data` as `series_${number}.data`,
            displayName:
              'displayName' in series[0] && series[0].displayName != null
                ? series[0].displayName
                : `${seriesDisplayName(series[0], {
                    showField,
                    showWhere,
                  })}/${seriesDisplayName(series[1], {
                    showField,
                    showWhere,
                  })}`,
            sortOrder:
              'sortOrder' in series[0] ? series[0].sortOrder : undefined,
            numberFormat:
              'numberFormat' in series[0] ? series[0].numberFormat : undefined,
            columnWidthPercent:
              'columnWidthPercent' in series[0]
                ? series[0].columnWidthPercent
                : undefined,
            visible: 'visible' in series[0] ? series[0].visible : undefined,
            color: undefined,
          },
        ]
      : series.map((s, i) => {
          return {
            dataKey: `series_${i}.data` as `series_${number}.data`,
            displayName: seriesDisplayName(s, {
              showField,
              showWhere,
            }),
            sortOrder: 'sortOrder' in s ? s.sortOrder : undefined,
            numberFormat: 'numberFormat' in s ? s.numberFormat : undefined,
            columnWidthPercent:
              'columnWidthPercent' in s ? s.columnWidthPercent : undefined,
            visible: 'visible' in s ? s.visible : undefined,
            color: 'color' in s ? s.color : undefined,
          };
        });

  return seriesMeta;
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

export function usePropertyOptions(types: ('number' | 'string' | 'bool')[]) {
  const { data: propertyTypeMappingsResult } = api.usePropertyTypeMappings();
  const propertyTypeMappings = useMemo(() => {
    const mapping = new Map(propertyTypeMappingsResult);

    // TODO: handle special properties somehow better...
    mapping.set('level', 'string');
    mapping.set('service', 'string');
    mapping.set('trace_id', 'string');
    mapping.set('span_id', 'string');
    mapping.set('parent_span_id', 'string');
    mapping.set('span_name', 'string');
    mapping.set('duration', 'number');
    mapping.set('body', 'string');

    return mapping;
  }, [propertyTypeMappingsResult]);

  // Blindly consume mappings so we keep the same API/shape as search
  const propertyOptions = useMemo(() => {
    return Array.from(propertyTypeMappings.entries())
      .flatMap(([key, value]) =>
        // @ts-ignore
        types.includes(value)
          ? [
              {
                value: key as string,
                label: `${key} (${value})`,
              },
            ]
          : [],
      )
      .sort((a, b) => a.value.length - b.value.length); // Prioritize shorter properties (likely to be less nested)
  }, [propertyTypeMappings, types]);

  return propertyOptions;
}

function useMetricTagOptions({ metricNames }: { metricNames?: string[] }) {
  const metrics = (metricNames ?? []).map(m => ({
    ...legacyMetricNameToNameAndDataType(m),
  }));
  const { data: metricTagsData } = api.useMetricsTags(metrics);

  const options = useMemo(() => {
    let tagNameSet = new Set<string>();
    if (metricNames != null && metricNames.length > 0) {
      const firstMetricName = metricNames[0]; // Start the set

      const tags =
        metricTagsData?.data?.filter(
          metric => metric.name === firstMetricName,
        )?.[0]?.tags ?? [];
      tags.forEach(tag => {
        Object.keys(tag).forEach(tagName => tagNameSet.add(tagName));
      });

      for (let i = 1; i < metricNames.length; i++) {
        const tags =
          metricTagsData?.data?.filter(
            metric => metric.name === metricNames[i],
          )?.[0]?.tags ?? [];
        const intersection = new Set<string>();
        tags.forEach(tag => {
          Object.keys(tag).forEach(tagName => {
            if (tagNameSet.has(tagName)) {
              intersection.add(tagName);
            }
          });
        });
        tagNameSet = intersection;
      }
    }

    return [
      { value: undefined, label: 'None' },
      ...Array.from(tagNameSet).map(tagName => ({
        value: tagName,
        label: tagName,
      })),
    ];
  }, [metricTagsData]);

  return options;
}

export function MetricTagSelect({
  value,
  setValue,
  metricNames,
}: {
  value: string | undefined | null;
  setValue: (value: string | undefined) => void;
  metricNames?: string[];
}) {
  const options = useMetricTagOptions({ metricNames });

  return (
    <AsyncSelect
      loadOptions={input => {
        return Promise.resolve(
          options.filter(v =>
            input.length > 0
              ? (v.value ?? 'None').toLowerCase().includes(input.toLowerCase())
              : true,
          ),
        );
      }}
      defaultOptions={options}
      value={
        value != null
          ? options.find(v => v.value === value)
          : { value: undefined, label: 'None' }
      }
      onChange={opt => setValue(opt?.value)}
      className="ds-select"
      classNamePrefix="ds-react-select"
    />
  );
}

export function MetricRateSelect({
  metricName,
  isRate,
  setIsRate,
}: {
  isRate: boolean;
  setIsRate: (isRate: boolean) => void;
  metricName: string | undefined | null;
}) {
  const { data: metricNamesData } = api.useMetricsNames();

  const metricType = useMemo(() => {
    return metricNamesData?.data?.find(metric => metric.name === metricName)
      ?.data_type;
  }, [metricNamesData, metricName]);

  return (
    <>
      {metricType === 'Sum' ? (
        <Checkbox
          title="When checked, this calculates the increase of the Sum metric over each time bucket, accounting for counter resets. Recommended for Sum metrics as opposed to the raw value."
          id="metric-use-rate"
          className="text-nowrap"
          labelClassName="fs-7"
          checked={isRate}
          onChange={() => setIsRate(!isRate)}
          label="Use Increase"
        />
      ) : null}
    </>
  );
}

export function FieldSelect({
  value,
  setValue,
  types,
  className,
  autoFocus,
}: {
  value: string | undefined | null;
  setValue: (value: string | undefined) => void;
  types: ('number' | 'string' | 'bool')[];
  className?: string;
  autoFocus?: boolean;
}) {
  const propertyOptions = usePropertyOptions(types);

  return (
    <AsyncSelect
      autoFocus={autoFocus}
      placeholder="Select a field..."
      loadOptions={input => {
        return Promise.resolve([
          { value: undefined, label: 'None' },
          ...propertyOptions
            .filter(v =>
              input.length > 0
                ? v.value.toLowerCase().includes(input.toLowerCase())
                : true,
            )
            .slice(0, 1000), // TODO: better surface too many results... somehow?
        ]);
      }}
      defaultOptions={[
        { value: undefined, label: 'None' },
        ...propertyOptions
          // Filter out index properties on initial dropdown
          .filter(v => v.value.match(/\.\d+(\.|$)/) == null)
          .slice(0, 1000), // TODO: better surface too many results... somehow?
      ]}
      value={
        value != null
          ? propertyOptions.find(v => v.value === value)
          : { value: undefined, label: 'None' }
      }
      onChange={opt => setValue(opt?.value)}
      className={`ds-select ${className ?? ''}`}
      classNamePrefix="ds-react-select"
    />
  );
}

export function TableSelect({
  table,
  setTableAndAggFn,
}: {
  setTableAndAggFn: (table: SourceTable, fn: AggFn) => void;
  table: string;
}) {
  return (
    <Select
      options={TABLES}
      className="ds-select w-auto text-nowrap"
      value={TABLES.find(v => v.value === table)}
      onChange={opt => {
        const val = opt?.value ?? 'logs';
        if (val === 'logs') {
          setTableAndAggFn('logs', 'count');
        } else if (val === 'metrics') {
          // TODO: This should set rate if metric field is a sum
          // or we should just reset the field if changing tables
          setTableAndAggFn('metrics', 'max');
        }
      }}
      classNamePrefix="ds-react-select"
    />
  );
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

export function GroupBySelect(
  props:
    | {
        fields?: string[];
        table: 'metrics';
        groupBy?: string | undefined;
        setGroupBy: (groupBy: string | undefined) => void;
      }
    | {
        table: 'logs';
        groupBy?: string | undefined;
        setGroupBy: (groupBy: string | undefined) => void;
      }
    | { table: 'rrweb' },
) {
  return (
    <>
      {props.table === 'metrics' && (
        <MetricTagSelect
          value={props.groupBy}
          setValue={props.setGroupBy}
          metricNames={props.fields}
        />
      )}
      {props.table === 'logs' && props.setGroupBy != null && (
        <FieldSelect
          className="w-auto text-nowrap"
          value={props.groupBy}
          setValue={props.setGroupBy}
          types={['number', 'bool', 'string']}
        />
      )}
    </>
  );
}

export function convertDateRangeToGranularityString(
  dateRange: [Date, Date],
  maxNumBuckets: number,
): Granularity {
  const start = dateRange[0].getTime();
  const end = dateRange[1].getTime();
  const diffSeconds = Math.floor((end - start) / 1000);
  const granularitySizeSeconds = Math.ceil(diffSeconds / maxNumBuckets);

  if (granularitySizeSeconds <= 15) {
    return Granularity.FifteenSecond;
  } else if (granularitySizeSeconds <= 30) {
    return Granularity.ThirtySecond;
  } else if (granularitySizeSeconds <= 60) {
    return Granularity.OneMinute;
  } else if (granularitySizeSeconds <= 5 * 60) {
    return Granularity.FiveMinute;
  } else if (granularitySizeSeconds <= 10 * 60) {
    return Granularity.TenMinute;
  } else if (granularitySizeSeconds <= 15 * 60) {
    return Granularity.FifteenMinute;
  } else if (granularitySizeSeconds <= 30 * 60) {
    return Granularity.ThirtyMinute;
  } else if (granularitySizeSeconds <= 3600) {
    return Granularity.OneHour;
  } else if (granularitySizeSeconds <= 2 * 3600) {
    return Granularity.TwoHour;
  } else if (granularitySizeSeconds <= 6 * 3600) {
    return Granularity.SixHour;
  } else if (granularitySizeSeconds <= 12 * 3600) {
    return Granularity.TwelveHour;
  } else if (granularitySizeSeconds <= 24 * 3600) {
    return Granularity.OneDay;
  } else if (granularitySizeSeconds <= 2 * 24 * 3600) {
    return Granularity.TwoDay;
  } else if (granularitySizeSeconds <= 7 * 24 * 3600) {
    return Granularity.SevenDay;
  } else if (granularitySizeSeconds <= 30 * 24 * 3600) {
    return Granularity.ThirtyDay;
  }

  return Granularity.ThirtyDay;
}

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

function inferValueColumns(meta: Array<{ name: string; type: string }>) {
  return filterColumnMetaByType(meta, [JSDataType.Number]);
}

function inferGroupColumns(meta: Array<{ name: string; type: string }>) {
  return filterColumnMetaByType(meta, [
    JSDataType.String,
    JSDataType.Map,
    JSDataType.Array,
  ]);
}

// Input: { ts, value1, value2, groupBy1, groupBy2 },
// Output: { ts, [value1Name, groupBy1, groupBy2]: value1, [...]: value2 }
export function formatResponseForTimeChart({
  res,
  dateRange,
  granularity,
  generateEmptyBuckets = true,
}: {
  dateRange: [Date, Date];
  granularity?: SQLInterval;
  res: ResponseJSON<Record<string, any>>;
  generateEmptyBuckets?: boolean;
}) {
  const meta = res.meta;
  const data = res.data;

  if (meta == null) {
    throw new Error('No meta data found in response');
  }

  const timestampColumn = inferTimestampColumn(meta);
  const valueColumns = inferValueColumns(meta) ?? [];
  const groupColumns = inferGroupColumns(meta) ?? [];

  if (timestampColumn == null) {
    throw new Error(
      `No timestamp column found with meta: ${JSON.stringify(meta)}`,
    );
  }

  // Timestamp -> { tsCol, line1, line2, ...}
  const tsBucketMap: Map<number, Record<string, any>> = new Map();
  const lineDataMap: {
    [keyName: string]: {
      dataKey: string;
      displayName: string;
      maxValue: number;
      minValue: number;
      color: string | undefined;
    };
  } = {};

  for (const row of data) {
    const date = new Date(row[timestampColumn.name]);
    const ts = date.getTime() / 1000;

    for (const valueColumn of valueColumns) {
      const tsBucket = tsBucketMap.get(ts) ?? {};

      const keyName = [
        valueColumn.name,
        ...groupColumns.map(g => row[g.name]),
      ].join(' · ');

      // UInt64 are returned as strings, we'll convert to number
      // and accept a bit of floating point error
      const rawValue = row[valueColumn.name];
      const value =
        typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue);

      tsBucketMap.set(ts, {
        ...tsBucket,
        [timestampColumn.name]: ts,
        [keyName]: value,
      });

      let color =
        groupColumns.length === 1
          ? logLevelColor(row[groupColumns[0].name])
          : undefined;
      // TODO: Set name and color correctly
      lineDataMap[keyName] = {
        dataKey: keyName,
        displayName: keyName,
        color,
        maxValue: Math.max(
          lineDataMap[keyName]?.maxValue ?? Number.NEGATIVE_INFINITY,
          value,
        ),
        minValue: Math.min(
          lineDataMap[keyName]?.minValue ?? Number.POSITIVE_INFINITY,
          value,
        ),
      };
    }
  }

  // TODO: Custom sort and truncate top N lines
  const sortedLineDataMap = Object.values(lineDataMap).sort((a, b) => {
    return a.maxValue - b.maxValue;
  });

  if (generateEmptyBuckets && granularity != null) {
    // Zero fill TODO: Make this an option
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

        for (const line of sortedLineDataMap) {
          tsBucket[line.dataKey] = 0;
        }

        tsBucketMap.set(ts, tsBucket);
      } else {
        for (const line of sortedLineDataMap) {
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

  // TODO: Return line color and names
  return {
    // dateRange: [minDate, maxDate],
    graphResults,
    timestampColumn,
    groupKeys: sortedLineDataMap.map(l => l.dataKey),
    lineNames: sortedLineDataMap.map(l => l.displayName),
    lineColors: sortedLineDataMap.map(l => l.color),
  };
}
