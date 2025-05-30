import pick from 'lodash/pick';
import objectHash from 'object-hash';
import store from 'store2';
import {
  ColumnMeta,
  extractColumnReference,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { MetricsDataType, TSource } from '@hyperdx/common-utils/dist/types';
import {
  hashCode,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { HDX_LOCAL_DEFAULT_SOURCES } from '@/config';
import { IS_LOCAL_MODE } from '@/config';
import { getMetadata } from '@/metadata';
import { parseJSON } from '@/utils';

const LOCAL_STORE_SOUCES_KEY = 'hdx-local-source';

function setLocalSources(fn: (prev: TSource[]) => TSource[]) {
  store.transact(LOCAL_STORE_SOUCES_KEY, fn, []);
}

function getLocalSources(): TSource[] {
  if (store.has(LOCAL_STORE_SOUCES_KEY)) {
    return store.get(LOCAL_STORE_SOUCES_KEY, []) ?? [];
  }
  // pull sources from env var
  try {
    const defaultSources = parseJSON(HDX_LOCAL_DEFAULT_SOURCES ?? '');
    if (defaultSources != null) {
      return defaultSources;
    }
  } catch (e) {
    console.error('Error fetching default sources', e);
  }
  // fallback to empty array
  return [];
}

// If a user specifies a timestampValueExpression with multiple columns,
// this will return the first one. We'll want to refine this over time
export function getFirstTimestampValueExpression(valueExpression: string) {
  return splitAndTrimWithBracket(valueExpression)[0];
}

export function getSpanEventBody(eventModel: TSource) {
  return eventModel.bodyExpression ?? eventModel?.spanNameExpression;
}

export function getDisplayedTimestampValueExpression(eventModel: TSource) {
  return (
    eventModel.displayedTimestampValueExpression ??
    getFirstTimestampValueExpression(eventModel.timestampValueExpression)
  );
}

export function getEventBody(eventModel: TSource) {
  const expression =
    eventModel.bodyExpression ??
    ('spanNameExpression' in eventModel
      ? eventModel?.spanNameExpression
      : undefined) ??
    eventModel.implicitColumnExpression; //??
  // (eventModel.kind === 'log' ? 'Body' : 'SpanName')
  const multiExpr = splitAndTrimWithBracket(expression ?? '');
  return multiExpr.length === 1 ? expression : multiExpr[0]; // TODO: check if we want to show multiple columns
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      if (IS_LOCAL_MODE) {
        return getLocalSources();
      }

      return hdxServer('sources').json<TSource[]>();
    },
  });
}

export function useSource({ id }: { id?: string | null }) {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      if (!IS_LOCAL_MODE) {
        return hdxServer('sources').json<TSource[]>();
      } else {
        return getLocalSources();
      }
    },
    select: (data: TSource[]): TSource => {
      return data.filter((s: any) => s.id === id)[0];
    },
    enabled: id != null,
  });
}

export function useUpdateSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ source }: { source: TSource }) => {
      if (IS_LOCAL_MODE) {
        setLocalSources(prev => {
          return prev.map(s => {
            if (s.id === source.id) {
              return source;
            }
            return s;
          });
        });
      } else {
        return await hdxServer(`sources/${source.id}`, {
          method: 'PUT',
          json: source,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: async ({ source }: { source: Omit<TSource, 'id'> }) => {
      if (IS_LOCAL_MODE) {
        const localSources = getLocalSources();
        const existingSource = localSources.find(
          stored =>
            objectHash(pick(stored, ['kind', 'name', 'connection'])) ===
            objectHash(pick(source, ['kind', 'name', 'connection'])),
        );
        if (existingSource) {
          // replace the existing source with the new one
          return {
            ...source,
            id: existingSource.id,
          };
        }
        const newSource = {
          ...source,
          id: `l${hashCode(Math.random().toString())}`,
        };
        setLocalSources(prev => {
          return [...prev, newSource];
        });
        return newSource;
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
        setLocalSources(prev => {
          return prev.filter(s => s.id !== id);
        });
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

export async function inferTableSourceConfig({
  databaseName,
  tableName,
  connectionId,
}: {
  databaseName: string;
  tableName: string;
  connectionId: string;
}): Promise<
  Partial<Omit<TSource, 'id' | 'name' | 'from' | 'connection' | 'kind'>>
> {
  const metadata = getMetadata();
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
  ).primary_key;
  const keys = splitAndTrimWithBracket(primaryKeys);

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
  const hasSpanEvents = columns.some(col => col.name === 'Events');

  const timestampColumns = filterColumnMetaByType(columns, [JSDataType.Date]);
  const primaryKeyTimestampColumn = timestampColumns?.find(c =>
    keys.find(
      k =>
        // If the key is a fn call like toUnixTimestamp(Timestamp), we need to strip it
        // We can't use substr match since "Timestamp" would match "TimestampTime"
        extractColumnReference(k) === c.name,
    ),
  );

  return {
    ...(primaryKeyTimestampColumn != null
      ? {
          timestampValueExpression: primaryKeyTimestampColumn.name,
        }
      : {}),
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
          bodyExpression: 'SpanName',
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

export function getDurationMsExpression(source: TSource) {
  return `(${source.durationExpression})/1e${(source.durationPrecision ?? 9) - 3}`;
}

export function getDurationSecondsExpression(source: TSource) {
  return `(${source.durationExpression})/1e${source.durationPrecision ?? 9}`;
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
}: {
  databaseName: string;
  tableName?: string;
  connectionId: string;
  metricType: MetricsDataType;
}) {
  if (!tableName) {
    return false;
  }

  const metadata = getMetadata();
  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });

  return hasAllColumns(columns, ReqMetricTableColumns[metricType]);
}
