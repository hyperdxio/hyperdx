import type { ChSql } from '@hyperdx/common-utils/dist/clickhouse';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { timeFilterExpr } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  type QuerySettings,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  MCP_CLICKHOUSE_SETTINGS,
  MCP_REQUEST_TIMEOUT,
} from '@/mcp/tools/query/helpers';
import { mcpUserError } from '@/mcp/utils/errors';
import { recordMcpSource } from '@/mcp/utils/tracing';

export function durationDivisor(precision: number): number {
  // durationPrecision is the number of decimal digits in the stored value.
  // precision=9 → ns (divide by 1e6 for ms), precision=6 → µs (divide by 1e3),
  // precision=3 → already ms (divide by 1).
  return Math.pow(10, Math.max(0, precision - 3));
}

export async function getMcpClickhouseClient(
  teamId: string,
  connectionId: string,
): Promise<ClickhouseClient | null> {
  const connection = await getConnectionById(teamId, connectionId, true);
  if (!connection) return null;
  return new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    requestTimeout: MCP_REQUEST_TIMEOUT,
  });
}

/**
 * Load the trace source a trace tool reads and a client for its connection, or
 * the error to return.
 */
export async function loadTraceSource(
  teamId: string,
  sourceId: string,
  toolName: string,
) {
  const source = await getSource(teamId, sourceId);
  if (!source) {
    return mcpUserError(
      `Source not found: ${sourceId}. Call clickstack_list_sources to find available source IDs.`,
    );
  }
  recordMcpSource(source);
  if (source.kind !== SourceKind.Trace) {
    return mcpUserError(
      `Source ${sourceId} is kind="${source.kind}". ${toolName} requires a source of kind="trace".`,
    );
  }
  const clickhouseClient = await getMcpClickhouseClient(
    teamId,
    source.connection.toString(),
  );
  if (!clickhouseClient) {
    return mcpUserError(`Connection not found for source: ${sourceId}`);
  }
  return { source, clickhouseClient };
}

// MCP settings win over source.querySettings so a source can't relax the
// max_execution_time ceiling, or the readonly guard that blocks DDL/DML
// injected through raw SQL filters.
export function mcpQuerySettings(querySettings: QuerySettings | undefined) {
  return {
    ...(querySettings
      ? Object.fromEntries(querySettings.map(s => [s.setting, s.value]))
      : {}),
    ...MCP_CLICKHOUSE_SETTINGS,
  };
}

export type TimeFilterParams = {
  timestampValueExpression: string;
  metadata: Metadata;
  databaseName: string;
  tableName: string;
  connectionId: string;
};

// Filters on every column of a multi-column timestampValueExpression and
// compares Date columns at day precision, so a composite "EventDate, EventTime"
// source prunes on its Date column without dropping same-day rows.
export function inclusiveTimeFilter(
  params: TimeFilterParams,
  start: Date,
  end: Date,
): Promise<ChSql> {
  return timeFilterExpr({
    ...params,
    dateRange: [start, end],
    dateRangeStartInclusive: true,
    dateRangeEndInclusive: true,
  });
}
