import omit from 'lodash/omit';
import objectHash from 'object-hash';
import store from 'store2';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { TSource } from '@/commonTypes';
import { IS_LOCAL_MODE } from '@/config';

import { hdxServer } from './api';
import { ColumnMeta, filterColumnMetaByType, JSDataType } from './clickhouse';
import { metadata } from './metadata';
import { hashCode } from './utils';

function setLocalSources(fn: (prev: TSource[]) => TSource[]) {
  store.transact('hdx-local-source', fn, []);
}
function getLocalSources(): TSource[] {
  return store.get('hdx-local-source', []) ?? [];
}

export function getSpanEventBody(eventModel: TSource) {
  return eventModel.bodyExpression ?? eventModel?.spanNameExpression;
}

export function getDisplayedTimestampValueExpression(eventModel: TSource) {
  return (
    eventModel.displayedTimestampValueExpression ??
    eventModel.timestampValueExpression
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
        const existingSource = getLocalSources().find(
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

function extractColumnReference(
  sql: string,
  maxIterations = 10,
): string | null {
  let iterations = 0;

  // Loop until we remove all function calls and get just the column, with a maximum limit
  while (/\w+\([^()]*\)/.test(sql) && iterations < maxIterations) {
    // Replace the outermost function with its content
    sql = sql.replace(/\w+\(([^()]*)\)/, '$1');
    iterations++;
  }

  // If we reached the max iterations without resolving, return null to indicate an issue
  return iterations < maxIterations ? sql.trim() : null;
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
  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });

  const primaryKeys = await metadata.getTablePrimaryKey({
    databaseName,
    tableName,
    connectionId,
  });
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
  };
}

export function getDurationMsExpression(source: TSource) {
  return `${source.durationExpression}/1e${(source.durationPrecision ?? 9) - 3}`;
}

export function getDurationSecondsExpression(source: TSource) {
  return `${source.durationExpression}/1e${source.durationPrecision ?? 9}`;
}
