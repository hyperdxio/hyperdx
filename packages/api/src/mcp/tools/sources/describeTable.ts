import { quoteIdentifierIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';
import { trace } from '@opentelemetry/api';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import {
  clickHouseErrorResult,
  isQueryOutOfTime,
  isServerError,
  MCP_REQUEST_TIMEOUT,
} from '@/mcp/tools/query/helpers';
import type { ToolRegistrar, ToolResult } from '@/mcp/tools/types';
import {
  mcpServerError,
  mcpUserError,
  sanitizeFetchError,
  validateObjectId,
} from '@/mcp/utils/errors';
import { MCP_TOOL_TIMEOUT_MS, runWithTimeout } from '@/mcp/utils/timeout';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';

import {
  databaseExists,
  fetchSampleRows,
  fetchTableDetails,
  fetchTablePage,
  isPrivilegeError,
  shapeTableDescription,
  shapeTableListEntry,
  type TableQueryContext,
} from './describeTableQueries';
import {
  decodeTableListCursor,
  type DescribeTableInput,
  describeTableSchema,
  encodeTableListCursor,
  MAX_SAMPLE_ROWS,
  validateDescribeTableInput,
} from './describeTableSchema';

// Sample rows can hold arbitrarily large values; keep them a small share of
// the response so they never crowd out the schema.
const SAMPLE_ROWS_MAX_CHARS = 10_000;
const RESPONSE_MAX_CHARS = 50_000;

function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * Not-found and permission failures are the caller's to fix, so they go back
 * as user errors with a hint; only infrastructure failures stay server errors.
 */
function tableQueryErrorResult(e: unknown, prefix: string) {
  const message = e instanceof Error ? e.message : String(e);
  let suffix: string | undefined;
  if (isPrivilegeError(e)) {
    suffix =
      "The ClickHouse user on this connection lacks the privileges needed. Ask the connection's administrator to grant them, or use another connection.";
  } else if (/UNKNOWN_(TABLE|DATABASE)|does not exist/i.test(message)) {
    suffix =
      'Call clickstack_describe_table with only database to list the tables it contains.';
  }
  return clickHouseErrorResult(e, { prefix, suffix });
}

async function listTables(
  ctx: TableQueryContext,
  input: DescribeTableInput,
): Promise<ToolResult> {
  const cursor = input.cursor ? decodeTableListCursor(input.cursor) : null;
  if (input.cursor && !cursor) {
    return mcpUserError(
      'Invalid cursor. Omit cursor to start over, or pass the exact `nextCursor` value returned by a previous call.',
    );
  }

  let rows;
  try {
    rows = await fetchTablePage(ctx, {
      database: input.database,
      afterName: cursor?.lastName,
      limit: input.limit,
    });
  } catch (e) {
    return tableQueryErrorResult(e, 'Failed to list tables');
  }

  // system.tables returns nothing for a missing database rather than erroring.
  if (rows.length === 0) {
    try {
      if (!(await databaseExists(ctx, input.database))) {
        return mcpUserError(
          `Database "${input.database}" not found or not visible to this connection's ClickHouse user.`,
        );
      }
    } catch (e) {
      return tableQueryErrorResult(e, 'Failed to look up database');
    }
  }

  const page = rows.slice(0, input.limit);
  const nextCursor =
    rows.length > input.limit
      ? encodeTableListCursor({ lastName: page[page.length - 1].name })
      : undefined;

  trace
    .getActiveSpan()
    ?.setAttribute('mcp.describe_table.table_count', page.length);

  return jsonResult({
    database: input.database,
    tables: page.map(shapeTableListEntry),
    ...(nextCursor && { nextCursor }),
    nextSteps: {
      describe:
        'Call clickstack_describe_table again with table set to get its columns, keys, and indices.',
    },
  });
}

function trimSampleRows(rows: Record<string, unknown>[]) {
  const perRowBudget = Math.floor(
    SAMPLE_ROWS_MAX_CHARS / Math.max(rows.length, 1),
  );
  let isTrimmed = false;
  const data = rows.map(row => {
    const trimmed = trimToolResponse(row, perRowBudget);
    isTrimmed ||= trimmed.isTrimmed;
    return trimmed.data;
  });
  return { data, isTrimmed };
}

async function sampleTableRows(
  ctx: TableQueryContext,
  args: { database: string; table: string; limit: number },
) {
  try {
    const rows = trimSampleRows(await fetchSampleRows(ctx, args));
    return { sampleRows: rows.data, isTrimmed: rows.isTrimmed };
  } catch (e) {
    // A slow View or Distributed table can time out on SELECT *; only a
    // connection failure should cost the schema already fetched.
    if (isServerError(e) && !isQueryOutOfTime(e)) throw e;
    // The schema is still useful when the user can read system tables but
    // not the table itself.
    return {
      sampleRowsError: sanitizeFetchError(e),
      sampleRowsHint:
        'Only the row sample failed; the schema above is complete. Retry without sampleRows, ' +
        "or check that the connection's ClickHouse user can SELECT from this table.",
      isTrimmed: false,
    };
  }
}

async function describeTable(
  ctx: TableQueryContext,
  input: DescribeTableInput & { table: string },
): Promise<ToolResult> {
  const { database, table } = input;
  let details;
  try {
    details = await fetchTableDetails(ctx, { database, table });
  } catch (e) {
    return tableQueryErrorResult(e, 'Failed to describe table');
  }

  if (!details) {
    return mcpUserError(
      `Table "${database}.${table}" not found or not visible to this connection's ClickHouse user. ` +
        'Call clickstack_describe_table with only database to list its tables.',
    );
  }

  const { indicesUnavailable, localTableUnavailable, ...shapeInput } = details;
  const { columns, ...description } = shapeTableDescription({
    database,
    ...shapeInput,
  });

  let sample = {};
  let sampleTrimmed = false;
  if (input.sampleRows > 0) {
    try {
      const { isTrimmed, ...result } = await sampleTableRows(ctx, {
        database,
        table,
        limit: input.sampleRows,
      });
      sample = result;
      sampleTrimmed = isTrimmed;
    } catch (e) {
      return clickHouseErrorResult(e, 'Failed to sample rows');
    }
  }

  trace.getActiveSpan()?.setAttributes({
    'mcp.describe_table.column_count': columns.length,
    'mcp.describe_table.index_count': description.dataSkippingIndices.length,
    'mcp.describe_table.engine': description.table.engine,
  });

  const rest = {
    ...description,
    ...(localTableUnavailable && {
      localTableHint:
        'Could not read the local table through cluster() (missing REMOTE grant, unknown cluster, or unreachable shard), so keys and key flags come from the Distributed table itself and may be empty.',
    }),
    ...(indicesUnavailable && {
      dataSkippingIndicesHint:
        'Could not read system.data_skipping_indices for this table (missing grant, or the local table was unreachable), so indices are not listed.',
    }),
    ...sample,
    nextSteps: {
      query:
        `Query it with clickstack_sql using connectionId "${ctx.connectionId}" and ` +
        `FROM ${quoteIdentifierIfNeeded(database)}.${quoteIdentifierIfNeeded(table)}. ` +
        'To query it with the builder tools, register it as a source with clickstack_save_source.',
    },
  };
  // Trim only the column list, against what the rest of the response leaves,
  // so a large sample cannot push columns out.
  const trimmedColumns = trimToolResponse(
    columns,
    RESPONSE_MAX_CHARS - JSON.stringify(rest).length,
  );

  return jsonResult({
    ...rest,
    columns: trimmedColumns.data,
    ...((sampleTrimmed || trimmedColumns.isTrimmed) && {
      note: 'Result was trimmed for context size. Some columns or sample values may be omitted.',
    }),
  });
}

export function registerDescribeTable({
  context,
  registerTool,
}: ToolRegistrar): void {
  const teamId = context.teamId.toString();

  registerTool(
    'clickstack_describe_table',
    {
      title: 'Describe ClickHouse Table',
      annotations: READ_ONLY_TOOL,
      description:
        'Inspect ClickHouse tables that are NOT registered as sources. For a source, ' +
        'call clickstack_describe_source instead.\n\n' +
        'Use this instead of querying system.tables / system.columns with clickstack_sql.\n\n' +
        'With table set, returns:\n' +
        '- table: engine, sorting key, primary key, partition key, approximate total rows and bytes\n' +
        '- columns[]: name, type, default kind/expression, comment, and whether it is in the sorting/primary key\n' +
        '- dataSkippingIndices[]: name, type, expression\n' +
        `- sampleRows: up to ${MAX_SAMPLE_ROWS} rows when sampleRows is set (off by default)\n\n` +
        'Without table, lists the tables in the database (name, engine, approximate rows), ' +
        'paginated. Pass the returned `nextCursor` back unchanged to fetch the next page.',
      inputSchema: describeTableSchema,
    },
    async rawInput => {
      const input = describeTableSchema.parse(rawInput);

      const invalid = validateDescribeTableInput(input);
      if (invalid) return mcpUserError(invalid);
      const invalidId = validateObjectId(input.connectionId, 'connectionId');
      if (invalidId) return invalidId;

      trace.getActiveSpan()?.setAttributes({
        'mcp.describe_table.mode': input.table ? 'describe' : 'list',
        'mcp.describe_table.connection_id': input.connectionId,
        'mcp.describe_table.database': input.database,
        'mcp.describe_table.sample_rows': input.sampleRows,
        ...(input.table && { 'mcp.describe_table.table': input.table }),
      });

      const connection = await getConnectionById(
        teamId,
        input.connectionId,
        true,
      );
      if (!connection) {
        return mcpUserError(
          `Connection "${input.connectionId}" not found. Call clickstack_list_sources to see available connections.`,
        );
      }

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
        requestTimeout: MCP_REQUEST_TIMEOUT,
      });

      const outcome = await runWithTimeout(
        signal => {
          const ctx = {
            clickhouseClient,
            connectionId: input.connectionId,
            signal,
          };
          return input.table
            ? describeTable(ctx, { ...input, table: input.table })
            : listTables(ctx, input);
        },
        { timeoutMs: MCP_TOOL_TIMEOUT_MS },
      );
      if (!outcome.timedOut) return outcome.value;

      logger.warn(
        { teamId, connectionId: input.connectionId, database: input.database },
        'clickstack_describe_table timed out',
      );
      return mcpServerError(
        'clickstack_describe_table timed out. The ClickHouse server may be under load; try again.',
      );
    },
  );
}
