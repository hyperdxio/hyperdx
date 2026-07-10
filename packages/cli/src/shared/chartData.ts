/**
 * Chart query response shaping.
 *
 * @source packages/app/src/ChartUtils.tsx (formatResponseForTimeChart,
 *   formatResponseForCategoricalChart, inferValueColumns,
 *   inferGroupColumns, toStartOfInterval, timeBucketByGranularity,
 *   shouldFillNullsWithZero) and packages/app/src/utils.ts
 *   (getLogLevelClass).
 *
 * Ported minus web-only concerns (previous-period overlay, CSS color
 * tokens). Series colors here are ANSI color names for terminal
 * rendering. Do NOT change the shaping rules without checking the web
 * implementation first.
 */

import {
  filterColumnMetaByType,
  inferTimestampColumn,
  JSDataType,
  type ColumnMetaType,
  type ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import type {
  ChartConfigWithOptDateRange,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';

// ---- Column inference (mirror of app ChartUtils) --------------------

function inferValueColumns(
  meta: Array<{ name: string; type: string }>,
  excluded: Set<string> = new Set(),
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

// ---- Time bucketing (mirror of app ChartUtils) -----------------------

/**
 * @source packages/app/src/ChartUtils.tsx (toStartOfInterval)
 */
function toStartOfInterval(date: Date, granularity: SQLInterval): Date {
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
      const daysSinceEpoch = date.getTime() / 1000 / 60 / 60 / 24;
      const daysSinceEpochRounded = roundFn(daysSinceEpoch / numInt) * numInt;

      return new Date(daysSinceEpochRounded * 1000 * 60 * 60 * 24);
    }
    default:
      return date;
  }
}

/**
 * @source packages/app/src/ChartUtils.tsx (timeBucketByGranularity)
 */
function timeBucketByGranularity(
  start: Date,
  end: Date,
  granularity: SQLInterval,
): Date[] {
  const buckets: Date[] = [];

  let current = toStartOfInterval(start, granularity);
  const granularitySeconds = convertGranularityToSeconds(granularity);
  while (current < end) {
    buckets.push(current);
    current = new Date(current.getTime() + granularitySeconds * 1000);
  }

  return buckets;
}

/**
 * @source packages/app/src/ChartUtils.tsx (shouldFillNullsWithZero)
 */
export function shouldFillNullsWithZero(
  fillNulls: ChartConfigWithOptDateRange['fillNulls'],
): boolean {
  // To match legacy behavior, fill nulls with 0 unless explicitly disabled
  return fillNulls !== false;
}

// ---- Log level coloring (mirror of app utils) ------------------------

/**
 * @source packages/app/src/utils.ts (getLogLevelClass)
 */
function getLogLevelClass(
  lvl: string | undefined,
): 'error' | 'warn' | 'info' | undefined {
  const level = lvl?.toLowerCase();
  if (level == null) {
    return undefined;
  }

  return level.startsWith('emerg') ||
    level.startsWith('alert') ||
    level.startsWith('crit') ||
    level.startsWith('err') ||
    level.startsWith('fatal')
    ? 'error'
    : level.startsWith('warn')
      ? 'warn'
      : level.startsWith('info') ||
          level.startsWith('debug') ||
          level.startsWith('ok') ||
          level.startsWith('notice') ||
          level.startsWith('verbose') ||
          level.startsWith('unset') ||
          level.startsWith('trace')
        ? 'info'
        : undefined;
}

/** ANSI color equivalents of the web's log level chart colors. */
function logLevelAnsiColor(
  key: string | number | undefined,
): string | undefined {
  const cls = getLogLevelClass(`${key}`);
  return cls === 'error'
    ? 'red'
    : cls === 'warn'
      ? 'yellow'
      : cls === 'info'
        ? 'green'
        : undefined;
}

/**
 * ANSI series palette — mirrors the ordering intent of the web's
 * categorical palette (blue first) using widely-supported ANSI colors.
 */
const ANSI_SERIES_COLORS = [
  'blue',
  'yellow',
  'red',
  'cyan',
  'green',
  'magenta',
  'blueBright',
  'yellowBright',
  'redBright',
  'greenBright',
] as const;

// ---- Time chart shaping ----------------------------------------------

const ChartKeyJoiner = ' · ';

interface TimeChartSeries {
  dataKey: string;
  displayName: string;
  /** The original result column name this series' values were pulled from. */
  valueColumnName: string;
  /** ANSI color name for terminal rendering */
  color: string;
}

export interface TimeChartData {
  /** Sorted by timestamp ascending. Keys: timestamp column + series dataKeys */
  graphResults: Record<string, number | undefined>[];
  timestampColumn: ColumnMetaType;
  series: TimeChartSeries[];
  groupColumns: string[];
  valueColumns: string[];
  isSingleValueColumn: boolean;
}

/**
 * Pivot a chart query response into per-timestamp buckets with one key
 * per series.
 *
 * Input rows: { ts, value1, value2, groupBy1, groupBy2 }
 * Output rows: { ts, [value1Name · groupBy1 · groupBy2]: value1, ... }
 *
 * @source packages/app/src/ChartUtils.tsx (formatResponseForTimeChart +
 *   addResponseToFormattedData), minus previous-period support.
 */
export function formatResponseForTimeChart({
  response,
  dateRange,
  granularity,
  generateEmptyBuckets = true,
  source,
}: {
  response: ResponseJSON<Record<string, unknown>>;
  dateRange: [Date, Date];
  granularity?: SQLInterval;
  generateEmptyBuckets?: boolean;
  source?: SourceResponse;
}): TimeChartData {
  const meta = response.meta;

  if (meta == null) {
    throw new Error('No meta data found in response');
  }

  const timestampColumn = inferTimestampColumn(meta);
  const valueColumns = inferValueColumns(meta) ?? [];
  const groupColumns = inferGroupColumns(meta) ?? [];
  const isSingleValueColumn = valueColumns.length === 1;
  const hasGroupColumns = groupColumns.length > 0;

  if (timestampColumn == null) {
    throw new Error(
      `No timestamp column found in result column metadata. Make sure a Date/DateTime column exists in the result set.\n\nResult column metadata: ${JSON.stringify(meta)}`,
    );
  }

  if (valueColumns.length === 0) {
    throw new Error(
      `No value columns found in result column metadata. Make sure a numeric column exists in the result set.\n\nResult column metadata: ${JSON.stringify(meta)}`,
    );
  }

  // Timestamp -> { tsCol, series1, series2, ...}
  const tsBucketMap: Map<
    number,
    Record<string, number | undefined>
  > = new Map();
  const seriesMap: Record<
    string,
    Omit<TimeChartSeries, 'color'> & { color?: string }
  > = {};

  const firstGroupIsLogLevel = firstGroupColumnIsLogLevel(source, groupColumns);

  for (const row of response.data) {
    const date = new Date(row[timestampColumn.name] as string | number);
    const ts = Math.round(date.getTime() / 1000);

    for (const valueColumn of valueColumns) {
      let tsBucket = tsBucketMap.get(ts);
      if (tsBucket == null) {
        tsBucket = { [timestampColumn.name]: ts };
        tsBucketMap.set(ts, tsBucket);
      }

      const keyName = [
        // Simplify the display name if there's only one series and a group by
        ...(isSingleValueColumn && hasGroupColumns ? [] : [valueColumn.name]),
        ...groupColumns.map(g => {
          const v = row[g.name];
          return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
        }),
      ].join(ChartKeyJoiner);

      // UInt64 are returned as strings, we'll convert to number
      // and accept a bit of floating point error
      const rawValue = row[valueColumn.name];
      const value =
        typeof rawValue === 'number'
          ? rawValue
          : Number.parseFloat(String(rawValue));

      tsBucket[keyName] = value;

      // Special handling for log level / trace severity colors
      let color: string | undefined = undefined;
      if (firstGroupIsLogLevel) {
        color = logLevelAnsiColor(
          row[groupColumns[0].name] as string | number | undefined,
        );
      }

      seriesMap[keyName] = {
        dataKey: keyName,
        displayName: keyName,
        valueColumnName: valueColumn.name,
        color,
      };
    }
  }

  // Sort log-level series info < warn < error, matching the web ordering
  const logLevelColorOrder = ['green', 'yellow', 'red'];
  const sortedSeries = Object.values(seriesMap).sort((a, b) => {
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
        const newBucket: Record<string, number | undefined> = {
          [timestampColumn.name]: ts,
        };

        for (const line of sortedSeries) {
          newBucket[line.dataKey] = 0;
        }

        tsBucketMap.set(ts, newBucket);
      } else {
        for (const line of sortedSeries) {
          if (tsBucket[line.dataKey] == null) {
            tsBucket[line.dataKey] = 0;
          }
        }
      }
    });
  }

  // Sort results again by timestamp
  const graphResults = Array.from(tsBucketMap.values()).sort(
    (a, b) => (a[timestampColumn.name] ?? 0) - (b[timestampColumn.name] ?? 0),
  );

  // Assign palette colors to series without a log-level color
  let colorIndex = 0;
  const seriesWithColors: TimeChartSeries[] = sortedSeries.map(line => ({
    ...line,
    color:
      line.color ??
      ANSI_SERIES_COLORS[colorIndex++ % ANSI_SERIES_COLORS.length],
  }));

  return {
    graphResults,
    timestampColumn,
    series: seriesWithColors,
    groupColumns: groupColumns.map(g => g.name),
    valueColumns: valueColumns.map(v => v.name),
    isSingleValueColumn,
  };
}

/**
 * @source packages/app/src/ChartUtils.tsx (firstGroupColumnIsLogLevel)
 */
function firstGroupColumnIsLogLevel(
  source: SourceResponse | undefined,
  groupColumns: ColumnMetaType[],
): boolean {
  if (!source || groupColumns.length !== 1) return false;
  if (source.kind === 'log') {
    return groupColumns[0].name === source.severityTextExpression;
  }
  if (source.kind === 'trace') {
    return groupColumns[0].name === source.statusCodeExpression;
  }
  return false;
}

// ---- Categorical (pie / bar) shaping ---------------------------------

const DEFAULT_MAX_CATEGORICAL_GROUPS = 500;

export interface CategoricalEntry {
  label: string;
  value: number;
  /** ANSI color name */
  color: string;
}

/**
 * @source packages/app/src/ChartUtils.tsx (formatResponseForCategoricalChart)
 */
export function formatResponseForCategoricalChart(
  data: ResponseJSON<Record<string, unknown>>,
  applyDefaultOrder: boolean = true,
): CategoricalEntry[] {
  if (data.meta == null) {
    throw new Error('No meta data found in response');
  }

  if (data.data.length === 0) return [];

  const valueColumns = inferValueColumns(data.meta) ?? [];
  if (valueColumns.length === 0) {
    throw new Error(
      `No value columns found in result column metadata. Make sure a numeric column exists in the result set.\n\nResult column metadata: ${JSON.stringify(data.meta)}`,
    );
  }
  const valueColumn = valueColumns[0].name;

  const groupByColumns = inferGroupColumns(data.meta);

  const labelsAndValues = data.data
    .map(row => {
      const label = groupByColumns?.length
        ? groupByColumns.map(({ name }) => row[name]).join(' - ')
        : valueColumn;
      const rawValue = row[valueColumn];
      const value =
        typeof rawValue === 'number'
          ? rawValue
          : Number.parseFloat(`${rawValue}`);
      return { label: String(label), value };
    })
    .filter(entry => !isNaN(entry.value) && isFinite(entry.value));

  if (applyDefaultOrder) {
    // Sort in descending order so the largest entry is always first and gets the first color in the palette
    labelsAndValues.sort((a, b) => b.value - a.value);
  }

  return labelsAndValues
    .slice(0, DEFAULT_MAX_CATEGORICAL_GROUPS)
    .map((entry, index) => ({
      ...entry,
      color: ANSI_SERIES_COLORS[index % ANSI_SERIES_COLORS.length],
    }));
}

// ---- Number chart ----------------------------------------------------

/**
 * The number chart value is the first numeric value in the first row of
 * the result (falls back to the first value of the first row).
 *
 * @source packages/app/src/components/DBNumberChart.tsx
 */
export function getNumberChartValue(
  data: ResponseJSON<Record<string, unknown>> | undefined,
): number | string | undefined {
  if (data == null) return undefined;
  const valueColumn = data.meta
    ? (filterColumnMetaByType(data.meta, [JSDataType.Number])?.[0] ?? undefined)
    : undefined;
  const value = valueColumn
    ? data.data?.[0]?.[valueColumn.name]
    : Object.values(data.data?.[0] ?? {})?.[0];
  return value as number | string | undefined;
}

// ---- Table chart -----------------------------------------------------

export interface TableChartColumn {
  dataKey: string;
  displayName: string;
  isGroupColumn: boolean;
}

/**
 * Derive table columns from result rows, mirroring the group-by column
 * detection logic of the web table chart.
 *
 * @source packages/app/src/components/DBTableChart.tsx (columns memo)
 */
export function deriveTableColumns({
  rows,
  selectLength,
  isRatio = false,
  groupByColumnsOnLeft = false,
}: {
  rows: Record<string, unknown>[];
  /** Number of select items for builder configs; undefined for raw SQL */
  selectLength?: number;
  isRatio?: boolean;
  groupByColumnsOnLeft?: boolean;
}): TableChartColumn[] {
  if (rows.length === 0) {
    return [];
  }

  const firstRow = rows.at(0);
  const allKeys = firstRow ? Object.keys(firstRow) : [];

  // We extract groupBy keys by counting the series columns to avoid parsing
  // the groupBy string, which may have complex expressions and aliases.
  let groupByKeys: string[] = [];
  if (selectLength != null) {
    const seriesCount = isRatio ? 1 : selectLength;
    const groupByCount = allKeys.length - seriesCount;
    groupByKeys = groupByCount > 0 ? allKeys.slice(-groupByCount) : [];
  }

  let orderedKeys = [...allKeys];
  if (groupByColumnsOnLeft && selectLength != null) {
    const seriesKeys = allKeys.filter(key => !groupByKeys.includes(key));
    orderedKeys = [...groupByKeys, ...seriesKeys];
  }

  return orderedKeys.map(key => ({
    dataKey: key,
    displayName: key,
    isGroupColumn: groupByKeys.includes(key),
  }));
}
