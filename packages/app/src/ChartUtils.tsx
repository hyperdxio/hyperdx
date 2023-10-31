import { useMemo, useRef } from 'react';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';

import api from './api';
import { add } from 'date-fns';
import SearchInput from './SearchInput';
import MetricTagFilterInput from './MetricTagFilterInput';
import Checkbox from './Checkbox';

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

export const METRIC_AGG_FNS = [
  { value: 'sum' as const, label: 'Sum' },
  { value: 'p99' as const, label: '99th Percentile' },
  { value: 'p95' as const, label: '95th Percentile' },
  { value: 'p90' as const, label: '90th Percentile' },
  { value: 'p50' as const, label: 'Median' },
  { value: 'avg' as const, label: 'Average' },
  { value: 'max' as const, label: 'Maximum' },
  { value: 'min' as const, label: 'Minimum' },
];

export type Granularity =
  | '30 second'
  | '1 minute'
  | '5 minute'
  | '10 minute'
  | '15 minute'
  | '30 minute'
  | '1 hour'
  | '2 hour'
  | '6 hour'
  | '12 hour'
  | '1 day'
  | '2 day'
  | '7 day'
  | '30 day';

export type ChartSeries = {
  table: string;
  type: 'time';
  aggFn: AggFn;
  field: string | undefined;
  where: string;
  groupBy: string[];
};

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

export function MetricTagSelect({
  value,
  setValue,
  metricName,
}: {
  value: string | undefined | null;
  setValue: (value: string | undefined) => void;
  metricName: string | undefined;
}) {
  const { data: metricTagsData } = api.useMetricsTags();

  const options = useMemo(() => {
    const tags =
      metricTagsData?.data?.filter(metric => metric.name === metricName)?.[0]
        ?.tags ?? [];

    const tagNameSet = new Set<string>();

    tags.forEach(tag => {
      Object.keys(tag).forEach(tagName => tagNameSet.add(tagName));
    });

    return [
      { value: undefined, label: 'None' },
      ...Array.from(tagNameSet).map(tagName => ({
        value: tagName,
        label: tagName,
      })),
    ];
  }, [metricTagsData, metricName]);

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

export function MetricSelect({
  aggFn,
  isRate,
  metricName,
  setAggFn,
  setFieldAndAggFn,
  setMetricName,
}: {
  aggFn: AggFn;
  isRate: boolean;
  metricName: string | undefined | null;
  setAggFn: (fn: AggFn) => void;
  setFieldAndAggFn: (field: string | undefined, fn: AggFn) => void;
  setMetricName: (value: string | undefined) => void;
}) {
  // TODO: Dedup with metric rate checkbox
  const { data: metricTagsData } = api.useMetricsTags();

  const aggFnWithMaybeRate = (aggFn: AggFn, isRate: boolean) => {
    if (isRate) {
      if (aggFn.includes('_rate')) {
        return aggFn;
      } else {
        return `${aggFn}_rate` as AggFn;
      }
    } else {
      if (aggFn.includes('_rate')) {
        return aggFn.replace('_rate', '') as AggFn;
      } else {
        return aggFn;
      }
    }
  };

  return (
    <>
      <div className="ms-3 flex-grow-1">
        <MetricNameSelect
          value={metricName}
          setValue={name => {
            const metricType = metricTagsData?.data?.find(
              metric => metric.name === name,
            )?.data_type;

            const newAggFn = aggFnWithMaybeRate(aggFn, metricType === 'Sum');

            setFieldAndAggFn(name, newAggFn);
          }}
        />
      </div>
      <div className="ms-3 flex-shrink-1">
        <MetricRateSelect
          metricName={metricName}
          isRate={isRate}
          setIsRate={(isRate: boolean) => {
            setAggFn(aggFnWithMaybeRate(aggFn, isRate));
          }}
        />
      </div>
    </>
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
  const { data: metricTagsData } = api.useMetricsTags();

  const metricType = useMemo(() => {
    return metricTagsData?.data?.find(metric => metric.name === metricName)
      ?.data_type;
  }, [metricTagsData, metricName]);

  return (
    <>
      {metricType === 'Sum' ? (
        <Checkbox
          title="Convert the sum metric into change over time (rate)"
          id="metric-use-rate"
          className="text-nowrap"
          labelClassName="fs-7"
          checked={isRate}
          onChange={() => setIsRate(!isRate)}
          label="Use Rate"
        />
      ) : null}
    </>
  );
}

export function MetricNameSelect({
  value,
  setValue,
}: {
  value: string | undefined | null;
  setValue: (value: string | undefined) => void;
}) {
  const { data: metricTagsData } = api.useMetricsTags();

  const options = useMemo(() => {
    return (
      metricTagsData?.data?.map(entry => ({
        value: entry.name,
        label: entry.name,
      })) ?? []
    );
  }, [metricTagsData]);

  return (
    <AsyncSelect
      loadOptions={input => {
        return Promise.resolve(
          options.filter(v =>
            input.length > 0
              ? v.value.toLowerCase().includes(input.toLowerCase())
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

export function FieldSelect({
  value,
  setValue,
  types,
  className,
}: {
  value: string | undefined | null;
  setValue: (value: string | undefined) => void;
  types: ('number' | 'string' | 'bool')[];
  className?: string;
}) {
  const propertyOptions = usePropertyOptions(types);

  return (
    <AsyncSelect
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

export type AggFn =
  | 'avg_rate'
  | 'avg'
  | 'count_distinct'
  | 'count'
  | 'max_rate'
  | 'max'
  | 'min_rate'
  | 'min'
  | 'p50_rate'
  | 'p50'
  | 'p90_rate'
  | 'p90'
  | 'p95_rate'
  | 'p95'
  | 'p99_rate'
  | 'p99'
  | 'sum_rate'
  | 'sum';

export function ChartSeriesForm({
  aggFn,
  field,
  groupBy,
  setAggFn,
  setField,
  setFieldAndAggFn,
  setTableAndAggFn,
  setGroupBy,
  setSortOrder,
  setTable,
  setWhere,
  sortOrder,
  table,
  where,
}: {
  aggFn: AggFn;
  field: string | undefined;
  groupBy: string | undefined;
  setAggFn: (fn: AggFn) => void;
  setField: (field: string | undefined) => void;
  setFieldAndAggFn: (field: string | undefined, fn: AggFn) => void;
  setTableAndAggFn: (table: string, fn: AggFn) => void;
  setGroupBy: (groupBy: string | undefined) => void;
  setSortOrder?: (sortOrder: SortOrder) => void;
  setTable: (table: string) => void;
  setWhere: (where: string) => void;
  sortOrder?: string;
  table: string;
  where: string;
}) {
  const labelWidth = 350;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isRate = useMemo(() => {
    return aggFn.includes('_rate');
  }, [aggFn]);
  const _setAggFn = (fn: AggFn, _isRate?: boolean) => {
    if (_isRate ?? isRate) {
      if (fn.includes('_rate')) {
        setAggFn(fn);
      } else {
        setAggFn(`${fn}_rate` as AggFn);
      }
    } else {
      if (fn.includes('_rate')) {
        setAggFn(fn.replace('_rate', '') as AggFn);
      } else {
        setAggFn(fn);
      }
    }
  };

  return (
    <div>
      <div className="d-flex align-items-center">
        <div style={{ width: labelWidth }}>
          <Select
            options={TABLES}
            className="ds-select"
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
        </div>
        <div className="ms-3" style={{ width: labelWidth }}>
          {table === 'logs' ? (
            <Select
              options={AGG_FNS}
              className="ds-select"
              value={AGG_FNS.find(v => v.value === aggFn)}
              onChange={opt => _setAggFn(opt?.value ?? 'count')}
              classNamePrefix="ds-react-select"
            />
          ) : (
            <Select
              options={METRIC_AGG_FNS}
              className="ds-select"
              value={METRIC_AGG_FNS.find(
                v => v.value === aggFn.replace('_rate', ''),
              )}
              onChange={opt => _setAggFn(opt?.value ?? 'sum')}
              classNamePrefix="ds-react-select"
            />
          )}
        </div>
        {table === 'logs' && aggFn != 'count' && aggFn != 'count_distinct' ? (
          <div className="ms-3 flex-grow-1">
            <FieldSelect value={field} setValue={setField} types={['number']} />
          </div>
        ) : null}
        {table === 'logs' && aggFn != 'count' && aggFn == 'count_distinct' ? (
          <div className="ms-3 flex-grow-1">
            <FieldSelect
              value={field}
              setValue={setField}
              types={['string', 'number', 'bool']}
            />
          </div>
        ) : null}
        {table === 'metrics' ? (
          <div className="d-flex align-items-center align-middle flex-grow-1">
            <MetricSelect
              metricName={field}
              setMetricName={setField}
              isRate={isRate}
              setAggFn={setAggFn}
              setFieldAndAggFn={setFieldAndAggFn}
              aggFn={aggFn}
            />
          </div>
        ) : null}
      </div>
      {table === 'logs' ? (
        <>
          <div className="d-flex mt-3 align-items-center">
            <div
              style={{ width: labelWidth }}
              className="text-muted fw-500 ps-2"
            >
              Where
            </div>
            <div className="ms-3 flex-grow-1">
              <SearchInput
                inputRef={searchInputRef}
                placeholder={'Filter results by a search query'}
                value={where}
                onChange={v => setWhere(v)}
                onSearch={() => {}}
              />
            </div>
          </div>
          <div className="d-flex mt-3 align-items-center">
            <div
              style={{ width: labelWidth }}
              className="text-muted fw-500 ps-2"
            >
              Group By
            </div>
            <div className="ms-3 flex-grow-1">
              <FieldSelect
                value={groupBy}
                setValue={setGroupBy}
                types={['number', 'bool', 'string']}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="d-flex mt-3 align-items-center">
            <div
              style={{ width: labelWidth }}
              className="text-muted fw-500 ps-2"
            >
              Where
            </div>
            <div className="ms-3 flex-grow-1">
              <MetricTagFilterInput
                placeholder={
                  field
                    ? 'Filter metric by tag...'
                    : 'Select a metric above to start filtering by tag...'
                }
                inputRef={searchInputRef}
                value={where}
                onChange={v => setWhere(v)}
                metricName={field}
              />
            </div>
          </div>
          <div className="d-flex mt-3 align-items-center">
            <div
              style={{ width: labelWidth }}
              className="text-muted fw-500 ps-2"
            >
              Group By
            </div>
            <div className="ms-3 flex-grow-1">
              <MetricTagSelect
                value={groupBy}
                setValue={setGroupBy}
                metricName={field}
              />
            </div>
          </div>
        </>
      )}
      {
        // TODO: support metrics
        sortOrder != null && setSortOrder != null && table === 'logs' && (
          <div className="d-flex mt-3 align-items-center">
            <div
              style={{ width: labelWidth }}
              className="text-muted fw-500 ps-2"
            >
              Sort Order
            </div>
            <div className="ms-3 flex-grow-1">
              <Select
                options={SORT_ORDER}
                className="ds-select"
                value={SORT_ORDER.find(v => v.value === sortOrder)}
                onChange={opt => setSortOrder(opt?.value ?? 'desc')}
                classNamePrefix="ds-react-select"
              />
            </div>
          </div>
        )
      }
    </div>
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

  if (granularitySizeSeconds <= 30) {
    return '30 second';
  } else if (granularitySizeSeconds <= 60) {
    return '1 minute';
  } else if (granularitySizeSeconds <= 5 * 60) {
    return '5 minute';
  } else if (granularitySizeSeconds <= 10 * 60) {
    return '10 minute';
  } else if (granularitySizeSeconds <= 15 * 60) {
    return '15 minute';
  } else if (granularitySizeSeconds <= 30 * 60) {
    return '30 minute';
  } else if (granularitySizeSeconds <= 3600) {
    return '1 hour';
  } else if (granularitySizeSeconds <= 2 * 3600) {
    return '2 hour';
  } else if (granularitySizeSeconds <= 6 * 3600) {
    return '6 hour';
  } else if (granularitySizeSeconds <= 12 * 3600) {
    return '12 hour';
  } else if (granularitySizeSeconds <= 24 * 3600) {
    return '1 day';
  } else if (granularitySizeSeconds <= 2 * 24 * 3600) {
    return '2 day';
  } else if (granularitySizeSeconds <= 7 * 24 * 3600) {
    return '7 day';
  } else if (granularitySizeSeconds <= 30 * 24 * 3600) {
    return '30 day';
  }

  return '30 day';
}

export function convertGranularityToSeconds(granularity: Granularity): number {
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
export function toStartOfInterval(date: Date, granularity: Granularity): Date {
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
  granularity: Granularity,
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
