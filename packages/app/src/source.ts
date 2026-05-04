import React, { useMemo } from 'react';
import pick from 'lodash/pick';
import objectHash from 'object-hash';
import {
  ColumnMeta,
  extractColumnReferencesFromKey,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
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
 * Returns a NumberFormat for duration display if the chart config's select
 * expressions exactly match a trace source's durationExpression. Returns
 * undefined if no match is detected.
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
  selectExpressions:
    | Array<{ valueExpression?: string; aggFn?: string }>
    | undefined,
): NumberFormat | undefined {
  if (!source || source.kind !== SourceKind.Trace || !source.durationExpression)
    return undefined;
  if (!selectExpressions || selectExpressions.length === 0) return undefined;

  const durationExpr = source.durationExpression;
  const precision = source.durationPrecision ?? 9;

  for (const sel of selectExpressions) {
    if (!sel.valueExpression) continue;
    if (!isDurationPreservingAggFn(sel.aggFn)) continue;

    if (sel.valueExpression === durationExpr) {
      return {
        output: 'duration',
        factor: Math.pow(10, -precision),
      };
    }
  }

  return undefined;
}

/**
 * Hook that resolves the effective numberFormat for a chart config.
 * If the config already has an explicit numberFormat, it's returned as-is.
 * Otherwise, auto-detects duration format when the chart uses a trace source
 * with duration expressions.
 */
export function useResolvedNumberFormat(
  config: ChartConfigWithOptDateRange,
): NumberFormat | undefined {
  const { data: source } = useSource({ id: config.source });

  return useMemo(() => {
    if (config.numberFormat) return config.numberFormat;

    if (!isBuilderChartConfig(config)) return undefined;

    const select = Array.isArray(config.select) ? config.select : undefined;
    return getTraceDurationNumberFormat(source, select);
  }, [config, source]);
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
