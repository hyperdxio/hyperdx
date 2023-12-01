import { 
    getLogStreamTableName,
    buildLogsPropertyTypeMappingsModel,
    buildTeamLogStreamWhereCondition,
    buildLogStreamAdditionalFilters
  } from "../index";
import {
    SearchQueryBuilder,
    buildSearchColumnName,
    buildSearchQueryWhereCondition,
  } from '../searchQueryParser';
  import SqlString from 'sqlstring';
  import { client } from '../client';
  import logger from '@/utils/logger';

  import type { ResponseJSON } from '@clickhouse/client';

export const getSessions = async ({
    endTime,
    limit,
    offset,
    q,
    startTime,
    tableVersion,
    teamId,
  }: {
    endTime: number; // unix in ms,
    limit: number;
    offset: number;
    q: string;
    startTime: number; // unix in ms
    tableVersion: number | undefined;
    teamId: string;
  }) => {
    const tableName = getLogStreamTableName(tableVersion, teamId);
    const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
      tableVersion,
      teamId,
      startTime,
      endTime,
    );
    const sessionsWhereClause = await buildSearchQueryWhereCondition({
      endTime,
      propertyTypeMappingsModel,
      query: `rum_session_id:* AND ${q}`,
      startTime,
    });
  
    const buildCustomColumn = (propName: string, alias: string) =>
      `MAX(${buildSearchColumnName('string', propName)}) as "${alias}"`;
  
    const columns = [
      ['userEmail', 'userEmail'],
      ['userName', 'userName'],
      ['teamName', 'teamName'],
      ['teamId', 'teamId'],
    ]
      .map(props => buildCustomColumn(props[0], props[1]))
      .map(column => SqlString.raw(column));
  
    const componentField = buildSearchColumnName('string', 'component');
    const sessionIdField = buildSearchColumnName('string', 'rum_session_id');
    if (!componentField || !sessionIdField) {
      throw new Error('component or sessionId is null');
    }
  
    const sessionsWithSearchQuery = SqlString.format(
      `SELECT
        MAX(timestamp) AS maxTimestamp,
        MIN(timestamp) AS minTimestamp,
        count() AS sessionCount,
        countIf(?='user-interaction') AS interactionCount,
        countIf(severity_text = 'error') AS errorCount,
        ? AS sessionId,
        ?
      FROM ??
      WHERE ? AND (?)
      GROUP BY sessionId
      ${
        // If the user is giving us an explicit query, we don't need to filter out sessions with no interactions
        // this is because the events that match the query might not be user interactions, and we'll just show 0 results otherwise.
        q.length === 0 ? 'HAVING interactionCount > 0' : ''
      }
      ORDER BY maxTimestamp DESC
      LIMIT ?, ?`,
      [
        SqlString.raw(componentField),
        SqlString.raw(sessionIdField),
        columns,
        tableName,
        buildTeamLogStreamWhereCondition(tableVersion, teamId),
        SqlString.raw(sessionsWhereClause),
        offset,
        limit,
      ],
    );
  
    const sessionsWithRecordingsQuery = SqlString.format(
      `WITH sessions AS (${sessionsWithSearchQuery}),
  sessionIdsWithRecordings AS (
    SELECT DISTINCT _rum_session_id as sessionId
    FROM ??
    WHERE span_name='record init' 
      AND (_rum_session_id IN (SELECT sessions.sessionId FROM sessions))
      AND (?)
  )
  SELECT * 
  FROM sessions 
  WHERE sessions.sessionId IN (
      SELECT sessionIdsWithRecordings.sessionId FROM sessionIdsWithRecordings
    )`,
      [
        tableName,
        SqlString.raw(SearchQueryBuilder.timestampInBetween(startTime, endTime)),
      ],
    );
  
    // If the user specifes a query, we need to filter out returned sessions
    // by the 'record init' event being included so we don't return "blank"
    // sessions, this can be optimized once we record background status
    // of all events in the RUM package
    const executedQuery =
      q.length === 0 ? sessionsWithSearchQuery : sessionsWithRecordingsQuery;
  
    const ts = Date.now();
    const rows = await client.query({
      query: executedQuery,
      format: 'JSON',
      clickhouse_settings: {
        additional_table_filters: buildLogStreamAdditionalFilters(
          tableVersion,
          teamId,
        ),
      },
    });
    const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
    logger.info({
      message: 'getSessions',
      query: executedQuery,
      teamId,
      took: Date.now() - ts,
    });
    return result;
  };
  