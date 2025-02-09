import omit from 'lodash/omit';
import objectHash from 'object-hash';
import store from 'store2';
import {
  ColumnMeta,
  extractColumnReference,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { hashCode } from '@hyperdx/common-utils/dist/utils';
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
  return valueExpression.split(',')[0].trim();
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
  return (
    eventModel.bodyExpression ??
    ('spanNameExpression' in eventModel
      ? eventModel?.spanNameExpression
      : undefined) ??
    eventModel.implicitColumnExpression //??
    // (eventModel.kind === 'log' ? 'Body' : 'SpanName')
  );
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
          stored => objectHash(omit(stored, 'id')) === objectHash(source),
        );
        if (existingSource) {
          return existingSource;
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
  const keys = primaryKeys.split(',').map(k => k.trim());

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

  const isOtelMetricSchema = hasAllColumns(columns, [
    'TimeUnix',
    'MetricName',
    'MetricDescription',
    'MetricUnit',
    'Value',
    'Flags',
    'ResourceAttributes',
    'Attributes',
    'ResourceAttributes',
  ]);

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
            'Timestamp, ServiceName, SeverityText, Body',
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
            'Timestamp, ServiceName, StatusCode, round(Duration / 1e6), SpanName',
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
        }
      : {}),
    ...(isOtelMetricSchema
      ? {
          serviceNameExpression: 'ServiceName',
          timestampValueExpression: 'TimeUnix',
          defaultTableSelectExpression:
            'TimeUnix, ServiceName, MetricName, Value, Attributes',
          metricNameExpression: 'MetricName',
          metricUnitExpression: 'MetricUnit',
          flagsExpression: 'Flags',
          valueExpression: 'Value',
          eventAttributesExpression: 'Attributes',
          resourceAttributesExpression: 'ResourceAttributes',
        }
      : {}),
  };
}

export function getDurationMsExpression(source: TSource) {
  return `${source.durationExpression}/1e${(source.durationPrecision ?? 9) - 3}`;
}

export function getDurationSecondsExpression(source: TSource) {
  return `${source.durationExpression}/1e${source.durationPrecision ?? 9}`;
}
