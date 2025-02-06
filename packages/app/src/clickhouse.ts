import type { ResponseJSON } from '@clickhouse/client';
import {
  chSql,
  ClickhouseClient,
  ColumnMeta,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from '@/config';
import { getLocalConnections } from '@/connection';
import { getMetadata } from '@/metadata';

const PROXY_CLICKHOUSE_HOST = '/api/clickhouse-proxy';

export const getClickhouseClient = () => {
  if (IS_LOCAL_MODE) {
    const localConnections = getLocalConnections();
    if (localConnections.length === 0) {
      console.warn('No local connection found');
      return new ClickhouseClient({
        host: '',
      });
    }
    return new ClickhouseClient({
      host: localConnections[0].host,
      username: localConnections[0].username,
      password: localConnections[0].password,
    });
  }
  return new ClickhouseClient({
    host: PROXY_CLICKHOUSE_HOST,
  });
};

export type Session = {
  errorCount: string;
  interactionCount: string;
  maxTimestamp: string;
  minTimestamp: string;
  recordingCount: string;
  sessionCount: string;
  sessionId: string;
  teamId: string;
  teamName: string;
  userEmail: string;
  userName: string;
};

// TODO: support where filtering
export function useSessions(
  {
    traceSource,
    sessionSource,
    dateRange,
    where,
    whereLanguage,
  }: {
    traceSource?: TSource;
    sessionSource?: TSource;
    dateRange: DateRange['dateRange'];
    where?: SearchCondition;
    whereLanguage?: SearchConditionLanguage;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const FIXED_SDK_ATTRIBUTES = ['teamId', 'teamName', 'userEmail', 'userName'];
  const SESSIONS_CTE_NAME = 'sessions';
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<Session>, Error>({
    queryKey: [
      'sessions',
      traceSource?.id,
      sessionSource?.id,
      dateRange,
      where,
      whereLanguage,
    ],
    queryFn: async () => {
      if (!traceSource || !sessionSource) {
        return [];
      }
      // TODO: we
      const [
        sessionsQuery,
        sessionIdsWithRecordingsQuery,
        sessionIdsWithUserActivityQuery,
      ] = await Promise.all([
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `${traceSource.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
              // TODO: can't use aggFn max/min here for string value field
              {
                alias: 'maxTimestamp',
                valueExpression: `MAX(${traceSource.timestampValueExpression})`,
              },
              {
                alias: 'minTimestamp',
                valueExpression: `MIN(${traceSource.timestampValueExpression})`,
              },
              {
                aggFn: 'count',
                alias: 'sessionCount',
                valueExpression: '*',
              },
              {
                aggFn: 'count',
                aggConditionLanguage: 'lucene',
                aggCondition: `${traceSource.eventAttributesExpression}.component:"user-interaction"`,
                valueExpression: '',
                alias: 'interactionCount',
              },
              {
                aggFn: 'count',
                aggConditionLanguage: 'lucene',
                aggCondition: `${traceSource.statusCodeExpression}:"Error"`,
                valueExpression: '',
                alias: 'errorCount',
              },
              {
                aggFn: 'count',
                aggConditionLanguage: 'lucene',
                aggCondition: `${traceSource.spanNameExpression}:"record init"`,
                valueExpression: '',
                alias: 'recordingCount',
              },
              ...FIXED_SDK_ATTRIBUTES.map(attr => ({
                valueExpression: `MAX(${traceSource.eventAttributesExpression}['${attr}'])`,
                alias: attr,
              })),
            ],
            from: traceSource.from,
            dateRange,
            where: `mapContains(${traceSource.resourceAttributesExpression}, 'rum.sessionId')`,
            whereLanguage: 'sql',
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            connection: traceSource.connection,
            groupBy: 'sessionId',
          },
          getMetadata(),
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${sessionSource.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
            ],
            from: sessionSource.from,
            dateRange,
            where: `${sessionSource.resourceAttributesExpression}['rum.sessionId'] IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME})`,
            whereLanguage: 'sql',
            timestampValueExpression: sessionSource.timestampValueExpression,
            implicitColumnExpression: sessionSource.implicitColumnExpression,
            connection: sessionSource.connection,
          },
          getMetadata(),
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${traceSource.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
            ],
            from: traceSource.from,
            dateRange,
            where: `(${traceSource.spanNameExpression}='record init' OR ${traceSource.spanNameExpression}='visibility') AND (${traceSource.resourceAttributesExpression}['rum.sessionId'] IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME}))`,
            whereLanguage: 'sql',
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            connection: traceSource?.connection,
          },
          getMetadata(),
        ),
      ]);

      const sessionsCTE = chSql`
        WITH _${SESSIONS_CTE_NAME} AS (${sessionsQuery}),
        ${SESSIONS_CTE_NAME} AS (
          SELECT * 
          FROM _${SESSIONS_CTE_NAME}
          HAVING interactionCount > 0 OR recordingCount > 0
          ORDER BY maxTimestamp DESC
          LIMIT 500
        )
      `;

      const finalQuery =
        where && where.length > 0
          ? chSql`
        ${sessionsCTE},
        sessionIdsWithRecordings AS (${sessionIdsWithRecordingsQuery}),
        sessionIdsWithUserActivity AS (${sessionIdsWithUserActivityQuery})
        SELECT *
        FROM ${SESSIONS_CTE_NAME}
        WHERE ${SESSIONS_CTE_NAME}.sessionId IN (
          SELECT sessionIdsWithRecordings.sessionId FROM sessionIdsWithRecordings
        ) OR ${SESSIONS_CTE_NAME}.sessionId IN (
          SELECT sessionIdsWithUserActivity.sessionId FROM sessionIdsWithUserActivity
        )
      `
          : chSql`
        ${sessionsCTE}
        SELECT *
        FROM ${SESSIONS_CTE_NAME}
        `;

      const json = await clickhouseClient
        .query({
          query: finalQuery.sql,
          query_params: finalQuery.params,
          connectionId: traceSource?.connection,
        })
        .then(res => res.json());

      return json;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
}

export function useDatabasesDirect(
  { connectionId }: { connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<ColumnMeta>, Error>({
    queryKey: [`direct_datasources/databases`, connectionId],
    queryFn: async () => {
      const json = await clickhouseClient
        .query({
          query: 'SHOW DATABASES',
          connectionId,
        })
        .then(res => res.json());

      return json;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
}

export function useTablesDirect(
  { database, connectionId }: { database: string; connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<ColumnMeta>, Error>({
    queryKey: [`direct_datasources/databases/${database}/tables`],
    queryFn: async () => {
      const paramSql = chSql`SHOW TABLES FROM ${{ Identifier: database }}`;
      const json = await clickhouseClient
        .query({
          query: paramSql.sql,
          query_params: paramSql.params,
          connectionId,
        })
        .then(res => res.json());

      return json;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
}
