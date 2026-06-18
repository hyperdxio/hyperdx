import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import type {
  ChartConfigWithDateRange,
  MetricTable,
} from '@hyperdx/common-utils/dist/types';
import {
  DisplayType,
  SourceKind,
  UseTextIndex,
} from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import ms from 'ms';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  convertToInternalTileConfig,
  isConfigTile,
} from '@/routers/external-api/v2/utils/dashboards';
import { trimToolResponse } from '@/utils/trimToolResponse';
import type { ExternalDashboardTileWithId } from '@/utils/zod';
import { externalDashboardTileSchemaWithId } from '@/utils/zod';

// ─── Source body expression helpers ──────────────────────────────────────────

export interface SourceBodyFields {
  kind: string;
  spanNameExpression?: string;
  bodyExpression?: string;
  implicitColumnExpression?: string;
}

/**
 * Resolve the body column expression for pattern mining from a source.
 * Mirrors the web app's getEventBody() logic (packages/app/src/source.ts).
 */
export function resolveBodyExpression(
  source: SourceBodyFields,
): string | undefined {
  let expression: string | undefined;
  if (source.kind === SourceKind.Trace) {
    expression = source.spanNameExpression;
  } else if (source.kind === SourceKind.Log) {
    expression = source.bodyExpression ?? source.implicitColumnExpression;
  }
  if (!expression) return undefined;
  const multiExpr = splitAndTrimWithBracket(expression);
  return multiExpr.length === 1 ? expression : multiExpr[0];
}

/** Reject bodyExpression values containing SQL-unsafe characters. */
// eslint-disable-next-line no-useless-escape
export const SAFE_BODY_EXPR_CHARS = /^[\w.':\[\]\-]+$/;

// ─── Safety limits ───────────────────────────────────────────────────────────

/** ClickHouse settings applied to all MCP query-tool executions.
 *  readonly=2 so max_execution_time can be set
 *  (readonly=1 rejects all setting changes). */
const MCP_CLICKHOUSE_SETTINGS = {
  max_execution_time: 30,
  readonly: 2,
} as const;

/**
 * HTTP request timeout for MCP query-tool ClickHouse clients.
 * Set slightly above max_execution_time so ClickHouse can return a clean
 * timeout error before the HTTP connection is aborted.
 */
const MCP_REQUEST_TIMEOUT = 32_000; // 30s query limit + 2s buffer

// ─── Where merging ───────────────────────────────────────────────────────────

export interface MergeWhereResult<T> {
  items: T[];
  /** Non-empty when items were skipped due to language mismatch. */
  warnings: string[];
}

/**
 * Merge a top-level `where` filter into each select item so it becomes part
 * of the per-item aggCondition. Table/line/number/pie display types don't have
 * a chart-level where — filtering is per-select-item.
 *
 * When the top-level and item-level languages differ, the item's own filter
 * takes precedence (we can't easily merge Lucene + SQL). A warning is returned
 * so callers can surface it in the response.
 */
export function mergeWhereIntoSelectItems<
  T extends {
    where?: string;
    whereLanguage?: 'lucene' | 'sql';
  },
>(
  items: T[],
  topWhere: string,
  topLang: 'lucene' | 'sql',
): MergeWhereResult<T> {
  if (!topWhere) return { items, warnings: [] };

  const warnings: string[] = [];

  const merged = items.map((item, idx) => {
    const itemWhere = item.where || '';
    const itemLang = item.whereLanguage || 'lucene';

    // If both languages match, combine with AND
    if (itemWhere && itemLang === topLang) {
      const combined = `(${topWhere}) AND (${itemWhere})`;
      return { ...item, where: combined, whereLanguage: topLang };
    }

    // If the item has no where, just use the top-level
    if (!itemWhere) {
      return { ...item, where: topWhere, whereLanguage: topLang };
    }

    // Languages differ — keep item's where unchanged (can't easily merge
    // Lucene + SQL). The item's own filter takes precedence.
    warnings.push(
      `select[${idx}]: top-level where (${topLang}) was NOT applied because this item uses whereLanguage:"${itemLang}". ` +
        `Set the item's whereLanguage to "${topLang}" or rewrite the top-level where in ${itemLang} to apply both filters.`,
    );
    return item;
  });

  return { items: merged, warnings };
}

// ─── Tile construction ───────────────────────────────────────────────────────

/**
 * Build a validated tile envelope for MCP tool execution.
 * Eliminates the repeated id/name/x/y/w/h boilerplate across tool handlers.
 */
export function buildTile(
  name: string,
  w: number,
  h: number,
  config: Record<string, unknown>,
): ExternalDashboardTileWithId {
  return externalDashboardTileSchemaWithId.parse({
    id: new ObjectId().toString(),
    name,
    x: 0,
    y: 0,
    w,
    h,
    config,
  });
}

// ─── Time range ──────────────────────────────────────────────────────────────

export function parseTimeRange(
  startTime?: string,
  endTime?: string,
): { error: string } | { startDate: Date; endDate: Date } {
  const endDate = endTime ? new Date(endTime) : new Date();
  const startDate = startTime
    ? new Date(startTime)
    : new Date(endDate.getTime() - ms('15m'));
  if (isNaN(endDate.getTime()) || isNaN(startDate.getTime())) {
    return {
      error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',
    };
  }
  if (startDate >= endDate) {
    return { error: 'endTime must be greater than startTime' };
  }
  return { startDate, endDate };
}

// ─── Result helpers ──────────────────────────────────────────────────────────

function isEmptyResult(result: unknown): boolean {
  if (result == null) return true;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.data) && obj.data.length === 0) return true;
    if (obj.rows != null && Number(obj.rows) === 0) return true;
  }
  return false;
}

function formatQueryResult(result: unknown) {
  const { data: trimmedResult, isTrimmed } = trimToolResponse(result);
  const empty = isEmptyResult(result);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            result: trimmedResult,
            ...(isTrimmed
              ? {
                  note: 'Result was trimmed for context size. Narrow the time range or add filters to reduce data.',
                }
              : {}),
            ...(empty
              ? {
                  hint: 'No data found in the queried time range. Try setting startTime to a wider window (e.g. 24 hours ago) or check that filters match existing data.',
                }
              : {}),
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ─── Tile execution ──────────────────────────────────────────────────────────

export async function runConfigTile(
  teamId: string,
  tile: ExternalDashboardTileWithId,
  startDate: Date,
  endDate: Date,
  options?: { maxResults?: number },
) {
  if (!isConfigTile(tile)) {
    return {
      isError: true as const,
      content: [
        { type: 'text' as const, text: 'Invalid tile: config field missing' },
      ],
    };
  }

  const internalTile = convertToInternalTileConfig(tile);
  const savedConfig = internalTile.config;

  if (isBuilderSavedChartConfig(savedConfig)) {
    const builderConfig = savedConfig;

    if (
      !builderConfig.source ||
      builderConfig.displayType === DisplayType.Markdown
    ) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Markdown tile: no query to execute.',
          },
        ],
      };
    }

    const source = await getSource(teamId, builderConfig.source);
    if (!source) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: `Source not found: ${builderConfig.source}. Call clickstack_list_sources to discover available source IDs.`,
          },
        ],
      };
    }

    const connection = await getConnectionById(
      teamId,
      source.connection.toString(),
      true,
    );
    if (!connection) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: `Connection not found for source: ${builderConfig.source}`,
          },
        ],
      };
    }

    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: MCP_REQUEST_TIMEOUT,
    });

    const isSearch = builderConfig.displayType === DisplayType.Search;
    const defaultTableSelect =
      'defaultTableSelectExpression' in source
        ? source.defaultTableSelectExpression
        : undefined;
    const implicitColumn =
      'implicitColumnExpression' in source
        ? source.implicitColumnExpression
        : undefined;
    const useTextIndexForImplicitColumn =
      'useTextIndexForImplicitColumn' in source
        ? source.useTextIndexForImplicitColumn
        : undefined;
    const searchOverrides = isSearch
      ? {
          select: builderConfig.select || defaultTableSelect || '*',
          groupBy: undefined,
          granularity: undefined,
          orderBy: [
            {
              ordering: 'DESC' as const,
              valueExpression: getFirstTimestampValueExpression(
                source.timestampValueExpression,
              ),
            },
          ],
          limit: { limit: options?.maxResults ?? 50, offset: 0 },
        }
      : {};

    const chartConfig = {
      ...builderConfig,
      ...searchOverrides,
      from: {
        databaseName: source.from.databaseName,
        tableName: source.from.tableName,
      },
      connection: source.connection.toString(),
      timestampValueExpression: source.timestampValueExpression,
      implicitColumnExpression: implicitColumn,
      useTextIndexForImplicitColumn,
      dateRange: [startDate, endDate] as [Date, Date],
    } satisfies ChartConfigWithDateRange;

    const metadata = getMetadata(clickhouseClient);
    try {
      const result = await clickhouseClient.queryChartConfig({
        config: chartConfig,
        metadata,
        querySettings: source.querySettings,
        opts: { clickhouse_settings: MCP_CLICKHOUSE_SETTINGS },
      });
      return formatQueryResult(result);
    } catch (e) {
      return clickHouseErrorResult(e);
    }
  }

  // Raw SQL tile — hydrate source fields for macro support ($__sourceTable, $__filters)
  let sourceFields: {
    from?: { databaseName: string; tableName: string };
    implicitColumnExpression?: string;
    useTextIndexForImplicitColumn?: UseTextIndex;
    metricTables?: MetricTable;
  } = {};
  if (savedConfig.source) {
    const source = await getSource(teamId, savedConfig.source);
    if (source) {
      sourceFields = {
        from: source.from,
        implicitColumnExpression:
          'implicitColumnExpression' in source
            ? source.implicitColumnExpression
            : undefined,
        useTextIndexForImplicitColumn:
          'useTextIndexForImplicitColumn' in source
            ? source.useTextIndexForImplicitColumn
            : undefined,
        metricTables:
          source.kind === SourceKind.Metric ? source.metricTables : undefined,
      };
    }
  }

  const connection = await getConnectionById(
    teamId,
    savedConfig.connection,
    true,
  );
  if (!connection) {
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: `Connection not found: ${savedConfig.connection}. Call clickstack_list_sources to discover available connection IDs.`,
        },
      ],
    };
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    requestTimeout: MCP_REQUEST_TIMEOUT,
  });

  const chartConfig = {
    ...savedConfig,
    ...sourceFields,
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  const metadata = getMetadata(clickhouseClient);
  try {
    const result = await clickhouseClient.queryChartConfig({
      config: chartConfig,
      metadata,
      querySettings: undefined,
      opts: { clickhouse_settings: MCP_CLICKHOUSE_SETTINGS },
    });
    return formatQueryResult(result);
  } catch (e) {
    return clickHouseErrorResult(e);
  }
}

// ─── Error hints ─────────────────────────────────────────────────────────────

/**
 * Decorate raw ClickHouse error messages with actionable guidance before
 * they reach the agent. Some ClickHouse errors are unhelpful in isolation —
 * e.g. "Cannot convert string '...Z' to type DateTime64(9)" leaves the agent
 * guessing about the right format. Catch common patterns and append a hint.
 */
export function clickHouseErrorResult(e: unknown): {
  isError: true;
  content: [{ type: 'text'; text: string }];
} {
  const raw = e instanceof Error ? e.message : String(e);
  const hint = errorHint(raw);
  const text = hint ? `${raw}\n\nHINT: ${hint}` : raw;
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text }],
  };
}

/** @internal Exported for testing only. */
export function errorHint(msg: string): string | null {
  if (
    /Cannot (convert|parse) string .* (to|as) (type )?DateTime64/i.test(msg)
  ) {
    return (
      "Wrap ISO timestamps with `parseDateTime64BestEffort('YYYY-MM-DDTHH:MM:SSZ')` — " +
      'this works for both DateTime and DateTime64 columns. For the sql tool, prefer ' +
      '`$__timeFilter(Timestamp)` which handles casting automatically. ' +
      'Bare ISO 8601 strings will NOT auto-cast to DateTime/DateTime64.'
    );
  }
  if (/Syntax error.*\bAS\b/.test(msg)) {
    return (
      'Quote the alias if it contains reserved words or special chars: ' +
      '`expr AS "alias"`. The MCP builder tools accept `alias` as a ' +
      'separate field on each select entry — use that to avoid SQL-quoting ' +
      'headaches.'
    );
  }
  if (
    /response length exceeds the maximum allowed size of V8 String/i.test(msg)
  ) {
    return (
      'Add a LIMIT, narrow the time range, or use a smaller granularity. ' +
      'The result row count is too large to serialize back to the agent.'
    );
  }
  if (/TOO_MANY_ROWS_OR_BYTES|RESULT_IS_TOO_LARGE/i.test(msg)) {
    return (
      'The query returned too many rows. ' +
      'Add a LIMIT, narrow the time range, or add filters to reduce the result set.'
    );
  }
  if (
    /Unknown (expression|identifier)|UNKNOWN_IDENTIFIER|Missing columns/i.test(
      msg,
    )
  ) {
    return (
      'Call clickstack_describe_source to discover available columns and ' +
      'map attribute keys before retrying.'
    );
  }
  if (/SETTING_CONSTRAINT_VIOLATION|shouldn't be greater than/i.test(msg)) {
    return (
      'This ClickHouse connection has a profile that restricts one or more ' +
      'settings to a value lower than requested. This is a server-side ' +
      'constraint — the query cannot override it. Try running the query ' +
      'without the constrained setting, or contact the connection administrator.'
    );
  }
  return null;
}
