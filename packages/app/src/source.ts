import React, { useMemo } from 'react';
import pick from 'lodash/pick';
import objectHash from 'object-hash';
import {
  ColumnMeta,
  ColumnMetaType,
  extractColumnReferencesFromKey,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { isRatioChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  BuilderSavedChartConfig,
  ChartConfigWithOptTimestamp,
  MetricsDataType,
  NumberFormat,
  SourceKind,
  SourceSchema,
  TLogSource,
  TMetricSource,
  TSessionSource,
  TSource,
  TSourceNoId,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { IS_LOCAL_MODE } from '@/config';
import { localSources } from '@/localStore';

// Columns for the sessions table as of OTEL Collector v0.129.1
export const SESSION_TABLE_EXPRESSIONS = {
  resourceAttributesExpression: 'ResourceAttributes',
  eventAttributesExpression: 'LogAttributes',
  timestampValueExpression: 'TimestampTime',
  implicitColumnExpression: 'Body',
} as const;

export const JSON_SESSION_TABLE_EXPRESSIONS = {
  ...SESSION_TABLE_EXPRESSIONS,
  timestampValueExpression: 'Timestamp',
} as const;

export function getSourceValidationNotificationId(sourceId: string) {
  return `source-validation-${sourceId}`;
}

// If a user specifies a timestampValueExpression with multiple columns,
// this will return the first one. We'll want to refine this over time
export function getFirstTimestampValueExpression(valueExpression: string) {
  return splitAndTrimWithBracket(valueExpression)[0];
}

export function getSpanEventBody(eventModel: TTraceSource) {
  return eventModel.spanNameExpression;
}

export function getDisplayedTimestampValueExpression(eventModel: TSource) {
  const displayed =
    eventModel.kind === SourceKind.Log || eventModel.kind === SourceKind.Trace
      ? eventModel.displayedTimestampValueExpression
      : undefined;
  return (
    displayed ??
    getFirstTimestampValueExpression(eventModel.timestampValueExpression)
  );
}

export function getEventBody(eventModel: TSource) {
  let expression: string | undefined;
  if (eventModel.kind === SourceKind.Trace) {
    expression = eventModel.spanNameExpression ?? undefined;
  } else if (eventModel.kind === SourceKind.Log) {
    expression =
      eventModel.bodyExpression ?? eventModel.implicitColumnExpression;
  }
  const multiExpr = splitAndTrimWithBracket(expression ?? '');
  return multiExpr.length === 1 ? expression : multiExpr[0];
}

// This function is for supporting legacy sources, which did not require this field.
// Will be defaulted to `TimestampTime` when queried, if undefined.
function addDefaultsToSource(source: TSource): TSource {
  if (source.kind === SourceKind.Session) {
    return {
      ...source,
      timestampValueExpression:
        source.timestampValueExpression ||
        SESSION_TABLE_EXPRESSIONS.timestampValueExpression,
    };
  }
  return source;
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      if (IS_LOCAL_MODE) {
        return localSources.getAll();
      }
      const rawSources = await hdxServer('sources').json<TSource[]>();
      const sources = rawSources.map(addDefaultsToSource);

      sources.forEach(source => {
        const result = SourceSchema.safeParse(source);
        if (!result.success) {
          const fields = result.error.issues
            .map(issue => issue.path.join('.'))
            .join(', ');
          notifications.show({
            id: getSourceValidationNotificationId(source.id),
            color: 'yellow',
            title: `Source "${source.name}" has validation issues`,
            message: React.createElement(
              React.Fragment,
              null,
              fields ? `Fields: ${fields}. ` : '',
              React.createElement(
                'a',
                { href: '/team#sources' },
                'Edit sources',
              ),
              ' to ensure compatibility.',
            ),
            autoClose: false,
          });
        }
      });

      return sources;
    },
  });
}

export function useSource<K extends SourceKind>(opts: {
  id?: string | null;
  kinds: K[];
}): UseQueryResult<Extract<TSource, { kind: K }> | undefined>;
export function useSource(opts: {
  id?: string | null;
}): UseQueryResult<TSource | undefined>;
export function useSource({
  id,
  kinds,
}: {
  id?: string | null;
  kinds?: SourceKind[];
}) {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      if (IS_LOCAL_MODE) {
        return localSources.getAll();
      }
      const rawSources = await hdxServer('sources').json<TSource[]>();
      return rawSources.map(addDefaultsToSource);
    },
    select: (data: TSource[]) => {
      const source = data.find(s => s.id === id);
      if (source && kinds?.length && !kinds.includes(source.kind))
        return undefined;
      return source;
    },
    enabled: id != null,
  });
}

export function useUpdateSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ source }: { source: TSource }) => {
      if (IS_LOCAL_MODE) {
        localSources.update(source.id, source);
        return;
      }
      return hdxServer(`sources/${source.id}`, {
        method: 'PUT',
        json: source,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: async ({ source }: { source: TSourceNoId }) => {
      if (IS_LOCAL_MODE) {
        const existing = localSources
          .getAll()
          .find(
            stored =>
              objectHash(pick(stored, ['kind', 'name', 'connection'])) ===
              objectHash(pick(source, ['kind', 'name', 'connection'])),
          );
        if (existing) {
          // Replace the existing source in-place rather than duplicating
          localSources.update(existing.id, source);
          return { ...source, id: existing.id };
        }
        return localSources.create(source);
      }

      return hdxServer(`sources`, {
        method: 'POST',
        json: source,
      }).json<TSource>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  return mut;
}

export function useDeleteSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (IS_LOCAL_MODE) {
        localSources.delete(id);
        return;
      }
      return hdxServer(`sources/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

function hasAllColumns(columns: ColumnMeta[], requiredColumns: string[]) {
  const nameToMeta = new Map(columns.map(c => [c.name, c]));
  const missingColumns = Array.from(requiredColumns).filter(
    col => !nameToMeta.has(col),
  );

  return missingColumns.length === 0;
}

type TStrippedSource<T extends TSource> = Partial<
  Omit<T, 'id' | 'name' | 'from' | 'connection'>
> & { kind: T['kind'] };
type InferredSourceConfig =
  | TStrippedSource<TLogSource>
  | TStrippedSource<TTraceSource>
  | TStrippedSource<TMetricSource>
  | TStrippedSource<TSessionSource>;

export async function inferTableSourceConfig({
  databaseName,
  tableName,
  connectionId,
  kind,
  metadata,
}: {
  databaseName: string;
  tableName: string;
  connectionId: string;
  kind: SourceKind;
  metadata: Metadata;
}): Promise<InferredSourceConfig> {
  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });

  const primaryKeys = (
    await metadata.getTableMetadata({
      databaseName,
      tableName,
      connectionId,
    })
  )?.primary_key;
  const primaryKeyColumns = primaryKeys
    ? new Set(extractColumnReferencesFromKey(primaryKeys))
    : new Set();

  const timestampColumns = filterColumnMetaByType(columns, [JSDataType.Date]);
  const primaryKeyTimestampColumn = timestampColumns?.find(c =>
    primaryKeyColumns.has(c.name),
  );

  const baseConfig = {
    ...(primaryKeyTimestampColumn != null
      ? { timestampValueExpression: primaryKeyTimestampColumn.name }
      : {}),
    kind,
  };

  if (kind === SourceKind.Session) {
    const isSessionSchema =
      hasAllColumns(columns, Object.values(SESSION_TABLE_EXPRESSIONS)) ||
      hasAllColumns(columns, Object.values(JSON_SESSION_TABLE_EXPRESSIONS));

    if (isSessionSchema) {
      return {
        ...baseConfig,
        resourceAttributesExpression:
          SESSION_TABLE_EXPRESSIONS.resourceAttributesExpression,
      };
    }
    return baseConfig;
  }

  const isOtelLogSchema = hasAllColumns(columns, [
    'Timestamp',
    'Body',
    'SeverityText',
    'TraceId',
    'SpanId',
    'ServiceName',
    'LogAttributes',
    'ResourceAttributes',
  ]);

  const isOtelSpanSchema = hasAllColumns(columns, [
    'Timestamp',
    'SpanName',
    'Duration',
    'SpanKind',
    'TraceId',
    'SpanId',
    'ParentSpanId',
    'ServiceName',
    'SpanAttributes',
    'ResourceAttributes',
    'StatusCode',
    'StatusMessage',
  ]);

  // Check if SpanEvents column is available
  const hasSpanEvents = columns.some(col => col.name === 'Events.Timestamp');

  return {
    ...baseConfig,
    ...(isOtelLogSchema
      ? {
          defaultTableSelectExpression:
            'Timestamp, ServiceName as service, SeverityText as level, Body',
          serviceNameExpression: 'ServiceName',
          bodyExpression: 'Body',

          displayedTimestampValueExpression: 'Timestamp',
          eventAttributesExpression: 'LogAttributes',
          implicitColumnExpression: 'Body',
          resourceAttributesExpression: 'ResourceAttributes',
          spanIdExpression: 'SpanId',
          traceIdExpression: 'TraceId',

          severityTextExpression: 'SeverityText',
        }
      : {}),
    ...(isOtelSpanSchema
      ? {
          displayedTimestampValueExpression: 'Timestamp',
          implicitColumnExpression: 'SpanName',
          defaultTableSelectExpression:
            'Timestamp, ServiceName as service, StatusCode as level, round(Duration / 1e6) as duration, SpanName',
          eventAttributesExpression: 'SpanAttributes',
          serviceNameExpression: 'ServiceName',
          resourceAttributesExpression: 'ResourceAttributes',

          durationExpression: 'Duration',
          durationPrecision: 9,
          parentSpanIdExpression: 'ParentSpanId',
          spanIdExpression: 'SpanId',
          spanKindExpression: 'SpanKind',
          spanNameExpression: 'SpanName',
          traceIdExpression: 'TraceId',
          statusCodeExpression: 'StatusCode',
          statusMessageExpression: 'StatusMessage',
          ...(hasSpanEvents ? { spanEventsValueExpression: 'Events' } : {}),
        }
      : {}),
  };
}

export function getDurationMsExpression(source: TTraceSource) {
  return `(${source.durationExpression})/1e${(source.durationPrecision ?? 9) - 3}`;
}

export function getDurationSecondsExpression(source: TTraceSource) {
  return `(${source.durationExpression})/1e${source.durationPrecision ?? 9}`;
}

// Aggregate functions whose output preserves the unit of the input value.
// count and count_distinct produce dimensionless counts and should not
// inherit the duration format.
const DURATION_PRESERVING_AGG_FNS = new Set([
  'avg',
  'min',
  'max',
  'sum',
  'any',
  'last_value',
  'quantile',
  'quantileMerge',
  'p50',
  'p90',
  'p95',
  'p99',
  'heatmap',
  'histogram',
  'histogramMerge',
]);

function isDurationPreservingAggFn(aggFn: string | undefined): boolean {
  if (!aggFn) return true; // no aggFn means raw expression — preserve unit
  // Handle combinator forms like "avgIf", "quantileIfState"
  const baseFn = aggFn.replace(/If(State|Merge)?$/, '');
  return DURATION_PRESERVING_AGG_FNS.has(baseFn);
}

/**
 * Returns a NumberFormat for duration display if the given select expressions
 * exactly matches a trace source's durationExpression. Returns undefined if
 * no match is detected.
 *
 * Only applies when the aggregate function preserves the unit of the input
 * (e.g. avg, min, max, sum, p95). Functions like count and count_distinct
 * produce dimensionless values and are skipped.
 *
 * Uses exact match only — the duration expression can be arbitrary SQL,
 * so substring or regex matching would be fragile.
 */
export function getTraceDurationNumberFormat(
  source: TSource | undefined,
  selectExpression: { valueExpression?: string; aggFn?: string },
): NumberFormat | undefined {
  if (!source || source.kind !== SourceKind.Trace || !source.durationExpression)
    return undefined;

  const durationExpr = source.durationExpression;
  const precision = source.durationPrecision ?? 9;

  if (!selectExpression.valueExpression) return undefined;
  if (!isDurationPreservingAggFn(selectExpression.aggFn)) return undefined;

  if (selectExpression.valueExpression === durationExpr) {
    return {
      output: 'duration',
      factor: Math.pow(10, -precision),
    };
  }

  return undefined;
}

/**
 * Gets the first series-specific number format from the config's select expressions, if any.
 *
 * The priority is as follows:
 * 1. The first series-specific numberFormat defined in the config's series, if any
 * 2. The first inferred duration-type format, when aggregating Duration values from a trace source
 */
export function getFirstSeriesNumberFormat(
  selectItems: Exclude<BuilderSavedChartConfig['select'], string | undefined>,
  source: TSource | undefined,
) {
  for (const series of selectItems) {
    if (series.numberFormat) {
      return series.numberFormat;
    }
  }

  for (const series of selectItems) {
    const format = getTraceDurationNumberFormat(source, series);
    if (format) {
      return format;
    }
  }
}

/** Get the number format to use for a single-series chart type. */
export function useSingleSeriesNumberFormat(
  config: ChartConfigWithOptTimestamp,
) {
  const { data: source } = useSource({ id: config.source });

  return useMemo(() => {
    if (
      isBuilderChartConfig(config) &&
      Array.isArray(config.select) &&
      config.select.length > 0
    ) {
      if (config.select[0].numberFormat) {
        return config.select[0].numberFormat;
      }

      if (config.numberFormat) {
        return config.numberFormat;
      }

      return getTraceDurationNumberFormat(source, config.select[0]);
    }

    return config.numberFormat;
  }, [source, config]);
}

interface ResolvedNumberFormats {
  /** A map from result column name to resolved number format, if any. */
  formatByColumn: Map<string, NumberFormat>;
  /** The chart-wide number format if present, or the first series-specific number format */
  chartFormat?: NumberFormat;
}

/**
 * Returns the number formats to use when formatting chart series values.
 *
 * The chart-wide number format is determined with the following priorities:
 * - The config's numberFormat field, if any
 * - The first series-specific numberFormat defined in the config's select expressions, if any
 * - The inferred duration format from the first duration-type series, if any
 *
 * The series-specific number format for each result column is determined with the following priorities:
 * - The series' numberFormat defined in the config, if present
 * - The config's top-level numberFormat, if present
 * - The inferred duration-type format, when selecting Duration values
 *
 * The series-specific formats are returned in a map from result column name (from `meta`) to number format.
 * These mappings are only available when meta is provided. Any series which does not have a format in the
 * map should fall back to the config's number format.
 */
export function useChartNumberFormats(
  config: ChartConfigWithOptTimestamp,
  meta?: ColumnMetaType[],
): ResolvedNumberFormats {
  const { data: source } = useSource({ id: config.source });

  return useMemo(() => {
    // The chart-wide number format does not depend on meta, so that it can be
    // resolved without querying.
    const chartFormat =
      config.numberFormat ??
      (isBuilderChartConfig(config) && Array.isArray(config.select)
        ? getFirstSeriesNumberFormat(config.select, source)
        : undefined);

    // meta must be provided to map result column names (from meta) to number formats
    if (!meta) {
      return { formatByColumn: new Map(), chartFormat };
    }

    // For Raw-SQL or string-based select configs, series-specific formats are not available
    if (!isBuilderChartConfig(config) || !Array.isArray(config.select)) {
      return { formatByColumn: new Map(), chartFormat };
    }

    // Ratio-based configs have exactly two series, which
    // are merged into the first result column.
    if (isRatioChartConfig(config.select, config)) {
      const effectiveNumberFormat =
        config.select[0]?.numberFormat ??
        config.select[1]?.numberFormat ??
        config.numberFormat;
      const formatByColumn =
        meta[0] && effectiveNumberFormat
          ? new Map([[meta[0].name, effectiveNumberFormat]])
          : new Map();
      return { formatByColumn, chartFormat };
    }

    // The series-specific number format is mapped to the query meta's column
    // name by index - the assumption is that query result columns are in
    // the order that they exist in the config's select.
    const allColumns = meta.map(column => column.name);
    const formatByColumn = new Map();
    for (let i = 0; i < config.select.length; i++) {
      const series = config.select[i];
      const key = allColumns[i];
      const effectiveNumberFormat =
        series.numberFormat ??
        config.numberFormat ??
        getTraceDurationNumberFormat(source, series);
      if (effectiveNumberFormat) {
        formatByColumn.set(key, effectiveNumberFormat);
      }
    }

    return { formatByColumn, chartFormat };
  }, [source, meta, config]);
}

// defined in https://github.com/open-telemetry/opentelemetry-proto/blob/cfbf9357c03bf4ac150a3ab3bcbe4cc4ed087362/opentelemetry/proto/metrics/v1/metrics.proto
// NOTE: We don't follow the standard perfectly, we enforce the required fields + a few more (ServiceName, MetricName, and ResourceAttributes primarily)
const ReqMetricTableColumns = {
  [MetricsDataType.Gauge]: [
    'TimeUnix',
    'ServiceName',
    'MetricName',
    'Value',
    'Attributes',
    'ResourceAttributes',
  ],
  [MetricsDataType.Histogram]: [
    'TimeUnix',
    'ServiceName',
    'MetricName',
    'Attributes',
    'ResourceAttributes',
    'Count',
    'Sum',
    'BucketCounts',
    'ExplicitBounds',
  ],
  [MetricsDataType.Sum]: [
    'TimeUnix',
    'ServiceName',
    'MetricName',
    'Value',
    'Attributes',
    'ResourceAttributes',
  ],
  [MetricsDataType.Summary]: [
    'Attributes',
    'TimeUnix',
    'Count',
    'Sum',
    'ValueAtQuantiles.Quantile',
    'ValueAtQuantiles.Value',
    'Flags',
    'ServiceName',
    'MetricName',
    'ResourceAttributes',
  ],
  [MetricsDataType.ExponentialHistogram]: [
    'Attributes',
    'TimeUnix',
    'Count',
    'Sum',
    'Scale',
    'ZeroCount',
    'PositiveOffset',
    'PositiveBucketCounts',
    'NegativeOffset',
    'NegativeBucketCounts',
    'Flags',
    'ServiceName',
    'MetricName',
    'ResourceAttributes',
  ],
};

export async function isValidMetricTable({
  databaseName,
  tableName,
  connectionId,
  metricType,
  metadata,
}: {
  databaseName: string;
  tableName?: string;
  connectionId: string;
  metricType: MetricsDataType;
  metadata: Metadata;
}) {
  if (!tableName) {
    return false;
  }

  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });

  return hasAllColumns(columns, ReqMetricTableColumns[metricType]);
}

export async function isValidSessionsTable({
  databaseName,
  tableName,
  connectionId,
  metadata,
}: {
  databaseName: string;
  tableName?: string;
  connectionId: string;
  metadata: Metadata;
}) {
  if (!tableName) {
    return false;
  }

  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });

  return (
    hasAllColumns(columns, Object.values(SESSION_TABLE_EXPRESSIONS)) ||
    hasAllColumns(columns, Object.values(JSON_SESSION_TABLE_EXPRESSIONS))
  );
}
