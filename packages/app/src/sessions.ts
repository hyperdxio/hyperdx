import type { ResponseJSON } from '@clickhouse/client';
import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { getMetadata } from '@/metadata';

import { getClickhouseClient, Session } from './clickhouse';

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

      const [
        sessionsQuery,
        sessionIdsWithRecordingsQuery,
        sessionIdsWithUserActivityQuery,
      ] = await Promise.all([
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `${traceSource.serviceNameExpression}`,
                alias: 'serviceName',
              },
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
                aggCondition: `${traceSource.statusCodeExpression}:error`,
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
            ...(whereLanguage &&
              where && {
                filters: [
                  {
                    type: whereLanguage,
                    condition: where,
                  },
                ],
              }),
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            connection: traceSource.connection,
            groupBy: 'serviceName, sessionId',
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
          ${
            // If the user is giving us an explicit query, we don't need to filter out sessions with no interactions
            // this is because the events that match the query might not be user interactions, and we'll just show 0 results otherwise.
            where ? '' : 'HAVING interactionCount > 0 OR recordingCount > 0'
          }
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
