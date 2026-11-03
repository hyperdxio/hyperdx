import { hasMacro } from '@hyperdx/common-utils/dist/macros';
import { hasVariableMacro } from '@hyperdx/common-utils/dist/variables';

import { getSource } from '@/controllers/sources';
import type { McpErrorResult } from '@/mcp/utils/errors';
import { mcpUserError } from '@/mcp/utils/errors';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { buildTile } from './helpers';

export type SourceLookup = (sourceId: string) => ReturnType<typeof getSource>;

/**
 * Source lookup memoized for one tool call, so a batch of queries against the
 * same source reads it from Mongo once.
 */
export function createSourceLookup(teamId: string): SourceLookup {
  const cache = new Map<string, ReturnType<typeof getSource>>();
  return sourceId => {
    let pending = cache.get(sourceId);
    if (!pending) {
      pending = getSource(teamId, sourceId);
      cache.set(sourceId, pending);
    }
    return pending;
  };
}

/**
 * Validate one raw SQL query and build the tile that runs it. Returns an error
 * result instead of a tile when the query can never run as written.
 */
export async function prepareSqlQuery(
  query: { sql: string; connectionId: string; sourceId?: string },
  lookupSource: SourceLookup,
): Promise<{ tile: ExternalDashboardTileWithId } | { error: McpErrorResult }> {
  // $__filter / $__conditionalAll read the variables a dashboard's filters
  // declare, and this tool has no dashboard behind it.
  if (hasVariableMacro(query.sql)) {
    return {
      error: mcpUserError(
        'The $__filter and $__conditionalAll macros only resolve for a tile ' +
          'on a dashboard, because they read the dashboard variables its ' +
          'filters declare. This tool has no dashboard, so they would be ' +
          'sent to ClickHouse as literal text. Inline the condition here, ' +
          'or save the query as a dashboard tile and validate it with ' +
          'clickstack_query_tile.',
      ),
    };
  }

  if (query.sourceId) {
    const source = await lookupSource(query.sourceId);
    if (!source) {
      return {
        error: mcpUserError(
          `Source not found: ${query.sourceId}. Call clickstack_list_sources to discover available source IDs.`,
        ),
      };
    }
    // $__sourceTable expands to the source's table, so a mismatch would run
    // the query against a table on another server.
    const sourceConnectionId = source.connection.toString();
    if (sourceConnectionId !== query.connectionId) {
      return {
        error: mcpUserError(
          `connectionId "${query.connectionId}" does not match the connection of source ` +
            `"${query.sourceId}" ("${sourceConnectionId}"). Use the source's own ` +
            'connection or drop sourceId from the call.',
        ),
      };
    }
  } else if (hasMacro(query.sql, 'sourceTable')) {
    return {
      error: mcpUserError(
        '$__sourceTable needs a sourceId to know which table to expand to. ' +
          'Pass the sourceId of a source from clickstack_list_sources, or write ' +
          "the source's `table` in place of the macro.",
      ),
    };
  }

  // Raw SQL only uses displayType to pick which query params to bind, and
  // only time-series types bind the interval params this tool advertises
  // ({intervalSeconds}, $__interval_s, $__timeInterval). Rows come back
  // the same either way, and ClickHouse ignores params a query never uses.
  const tile = buildTile('MCP SQL', 24, 6, {
    configType: 'sql' as const,
    displayType: 'line' as const,
    connectionId: query.connectionId,
    sourceId: query.sourceId,
    sqlTemplate: query.sql,
  });
  return { tile };
}
