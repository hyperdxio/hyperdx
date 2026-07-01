import { ClickHouseError } from '@clickhouse/client-common';
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
import type { McpErrorResult } from '@/mcp/utils/errors';
import { mcpServerError, mcpUserError } from '@/mcp/utils/errors';
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

// ─── Increase top-N cap hint ────────────────────────────────────────────────

/**
 * Group limit applied by the metric renderer when `aggFn:"increase"` is
 * combined with `groupBy`. Mirrors `INCREASE_MAX_NUM_GROUPS` in
 * `packages/common-utils/src/core/renderChartConfig.ts`. Surfaced to MCP
 * callers as a hint so they can reason about why high-cardinality groupBys
 * may be truncated.
 */
export const INCREASE_TOP_N_CAP = 20;

/**
 * Append a hint message onto a parsed tool response body. All hint
 * writers share `hints: string[]` so multiple advisories can coexist
 * (e.g. the increase top-N cap and the single-bucket collapse hint can
 * legitimately both apply to the same result).
 */
export function appendHint(parsed: Record<string, unknown>, hint: string) {
  const existing = Array.isArray(parsed.hints) ? parsed.hints : [];
  parsed.hints = [...existing, hint];
}

/**
 * Count the distinct groupBy combinations present in a result set.
 * Resolves each comma-separated groupBy segment against the row keys
 * (the renderer aliases group columns by their literal expression).
 * Returns null when no segment matches any row key — the caller should
 * treat that as "count unknown".
 */
function countDistinctGroups(
  data: Array<Record<string, unknown>>,
  groupBy: string,
): number | null {
  const segments = splitAndTrimWithBracket(groupBy);
  const sample = data[0];
  if (!sample || typeof sample !== 'object') return null;
  const resolvable = segments.filter(seg => seg in sample);
  if (resolvable.length === 0) return null;
  const seen = new Set<string>();
  for (const row of data) {
    seen.add(JSON.stringify(resolvable.map(seg => row[seg])));
  }
  return seen.size;
}

/**
 * Mutates a successful tool result envelope in place to add a neutral
 * informational hint when the renderer's increase+groupBy top-N cap
 * likely applied. Safe to call unconditionally — does nothing for empty
 * results, error results, queries that don't combine `aggFn:"increase"`
 * with a non-empty `groupBy`, or results whose distinct group count is
 * below the cap (no truncation possible).
 */
export function annotateIncreaseTopNHint(
  result: { content?: { type: string; text?: string }[]; isError?: boolean },
  selectItems: ReadonlyArray<{ aggFn?: string }>,
  groupBy: string | undefined,
): void {
  if (result.isError) return;
  const first = result.content?.[0];
  if (first?.type !== 'text' || typeof first.text !== 'string') return;
  if (!groupBy || groupBy.trim() === '') return;
  if (!selectItems.some(s => s.aggFn === 'increase')) return;
  try {
    const parsed = JSON.parse(first.text);
    const data = parsed?.result?.data;
    if (!Array.isArray(data) || data.length === 0) return;
    // Only warn when the result actually carries enough distinct groups
    // to have hit the renderer cap. When the group column cannot be
    // resolved from the rows, skip the hint rather than crying wolf.
    const distinctGroups = countDistinctGroups(data, groupBy);
    if (distinctGroups === null || distinctGroups < INCREASE_TOP_N_CAP) return;
    appendHint(
      parsed,
      `aggFn:"increase" combined with groupBy is capped at the top ${INCREASE_TOP_N_CAP} ` +
        `groups by max bucket sum at the renderer layer. ` +
        `Results may not include every group present in the underlying data.`,
    );
    first.text = JSON.stringify(parsed, null, 2);
  } catch {
    // leave result unmodified on parse failure
  }
}

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
                  hints: [
                    'No data found in the queried time range. Try setting startTime to a wider window (e.g. 24 hours ago) or check that filters match existing data.',
                  ],
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

// ─── Source-kind / select-shape guardrail ────────────────────────────────────

type SelectItemForKindCheck = { metricType?: unknown };

/**
 * Reject builder-config queries where the select items' metric annotations
 * don't match the source kind:
 *   - Non-metric source with any select item carrying `metricType` would
 *     fall through to SQL generation that references the metric `Value`
 *     column and fail with a cryptic ClickHouse error.
 *   - Metric source with no select item carrying `metricType` would also
 *     reach the renderer in a broken state.
 *
 * Catching both up-front gives the agent a clear next action that mirrors
 * the wording on `clickstack_list_metrics` / `clickstack_describe_metric`.
 *
 * Returns an error envelope on mismatch, or `null` when the select shape
 * is consistent with the source kind (or the select is a raw string that
 * the caller already parsed by hand).
 */
export function assertSourceKindMatchesSelect(
  source: { kind: string },
  select: unknown,
): McpErrorResult | null {
  // Raw-string select (rare on the builder path) — the renderer handles
  // it; no metric annotations to inspect.
  if (typeof select === 'string') return null;
  if (!Array.isArray(select)) return null;

  const metricItemCount = (select as SelectItemForKindCheck[]).filter(
    item =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.metricType === 'string' &&
      item.metricType.length > 0,
  ).length;

  const isMetricSource = source.kind === SourceKind.Metric;

  if (isMetricSource && metricItemCount === 0) {
    return mcpUserError(
      'Source kind is "metric", but no select item specifies metricType + metricName. ' +
        'Each select item on a metric source must set metricType ("gauge" | "sum" | "histogram") ' +
        'and metricName (e.g. metricName:"system.cpu.utilization"). Call ' +
        'clickstack_describe_source or clickstack_list_metrics to discover available metric names.',
    );
  }

  if (!isMetricSource && metricItemCount > 0) {
    return mcpUserError(
      `Source kind is "${source.kind}", not metric — but ${metricItemCount} select item(s) ` +
        'set metricType. metricType + metricName only work on metric sources. ' +
        'Drop the metric fields to query this source, or call clickstack_list_sources to find a ' +
        'source whose kind is "metric".',
    );
  }

  return null;
}

// ─── Tile execution ──────────────────────────────────────────────────────────

export async function runConfigTile(
  teamId: string,
  tile: ExternalDashboardTileWithId,
  startDate: Date,
  endDate: Date,
  options?: { maxResults?: number; granularity?: string },
) {
  if (!isConfigTile(tile)) {
    return mcpUserError('Invalid tile: config field missing');
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
      return mcpUserError(
        `Source not found: ${builderConfig.source}. Call clickstack_list_sources to discover available source IDs.`,
      );
    }

    // Reject metric-style select against a non-metric source (and vice
    // versa) before the renderer composes SQL against the wrong table.
    const kindMismatch = assertSourceKindMatchesSelect(
      source,
      builderConfig.select,
    );
    if (kindMismatch) return kindMismatch;

    const connection = await getConnectionById(
      teamId,
      source.connection.toString(),
      true,
    );
    if (!connection) {
      return mcpUserError(
        `Connection not found for source: ${builderConfig.source}`,
      );
    }

    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: MCP_REQUEST_TIMEOUT,
    });

    const isSearch = builderConfig.displayType === DisplayType.Search;
    const isMetricSource = source.kind === SourceKind.Metric;
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

    // Metric sources need three adjustments before the renderer can
    // translate the query:
    //   1. `from.tableName` is blank — the renderer picks the correct
    //      per-kind ClickHouse table from `metricTables` at render time.
    //   2. `metricTables` must be threaded onto the chart config (mirrors
    //      packages/api/src/routers/external-api/v2/charts.ts:261-267).
    //   3. Each select item's `valueExpression` defaults to "Value" (the
    //      metric value column) when missing — agents normally omit it.
    const metricSelectOverrides =
      isMetricSource && Array.isArray(builderConfig.select)
        ? {
            select: builderConfig.select.map(item =>
              typeof item === 'string'
                ? item
                : {
                    ...item,
                    valueExpression: item.valueExpression ?? 'Value',
                  },
            ),
          }
        : {};

    // Re-inject granularity for time charts. The MCP tool input carries
    // it, but buildTile parses through externalDashboardTileSchemaWithId,
    // whose line/stacked_bar schemas don't declare `granularity`, so Zod
    // strips it. Without this the renderer's `granularity != null` guard
    // fails and no __hdx_time_bucket is emitted — every timeseries call
    // collapses to one row per group. Default to "auto" so the renderer
    // picks a bucket, mirroring the REST charts path
    // (packages/api/src/routers/external-api/v2/charts.ts:289).
    // Search tiles intentionally have no granularity (handled above).
    const granularityOverride =
      !isSearch &&
      (builderConfig.displayType === DisplayType.Line ||
        builderConfig.displayType === DisplayType.StackedBar)
        ? { granularity: options?.granularity ?? 'auto' }
        : {};

    const chartConfig = {
      ...builderConfig,
      ...searchOverrides,
      ...metricSelectOverrides,
      ...granularityOverride,
      from: {
        databaseName: source.from.databaseName,
        tableName: isMetricSource ? '' : source.from.tableName,
      },
      ...(isMetricSource && { metricTables: source.metricTables }),
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
    return mcpUserError(
      `Connection not found: ${savedConfig.connection}. Call clickstack_list_sources to discover available connection IDs.`,
    );
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
 * ClickHouse server-side error types that indicate an infrastructure problem
 * rather than a user query issue. These appear in `ClickHouseError.type` when
 * the ClickHouse server itself reports a connection/network failure (e.g. to
 * a replica or Zookeeper).
 */
const SERVER_CH_ERROR_TYPES = new Set([
  'NETWORK_ERROR',
  'SOCKET_TIMEOUT',
  'POCO_EXCEPTION',
  'ALL_CONNECTION_TRIES_FAILED',
]);

/**
 * Node.js system error codes that indicate a TCP-level connection failure.
 * These appear on plain `Error` objects thrown by the ClickHouse HTTP client
 * when the server is unreachable — the client never gets an HTTP response,
 * so no `ClickHouseError` is constructed.
 */
const SERVER_NODE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Check whether an error is a ClickHouseError, using both `instanceof`
 * and a constructor-name fallback. The fallback handles the case where
 * multiple copies of `@clickhouse/client-common` are installed (e.g.
 * the root workspace uses one version while `common-utils` bundles
 * another). In that scenario, `instanceof` fails because the class
 * identities are different even though the shapes are identical.
 */
function isClickHouseError(
  err: unknown,
): err is ClickHouseError & { type: string } {
  if (err instanceof ClickHouseError) return true;
  if (
    err instanceof Error &&
    err.constructor?.name === 'ClickHouseError' &&
    'type' in err &&
    typeof (err as Record<string, unknown>).type === 'string'
  ) {
    return true;
  }
  return false;
}

/**
 * Extract the ClickHouse error `type` from an error, walking `.cause` to
 * find the original `ClickHouseError` from `@clickhouse/client-common`.
 *
 * Uses `instanceof` with a constructor-name fallback to handle duplicate
 * package installations across the monorepo (see `isClickHouseError`).
 *
 * @internal Exported for testing only.
 */
export function getClickHouseErrorType(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  // ClickHouseQueryError wraps the original ClickHouseError as .cause
  if (isClickHouseError(e.cause)) {
    return e.cause.type;
  }
  // Direct ClickHouseError (has .type on itself)
  if (isClickHouseError(e)) {
    return e.type;
  }
  return undefined;
}

/**
 * Check whether an error represents a system-level infrastructure failure
 * rather than a user query issue. Covers both ClickHouse server-side error
 * types (e.g. NETWORK_ERROR) and Node.js TCP-level errors (e.g. ECONNREFUSED)
 * which the client throws as plain `Error` objects.
 *
 * @internal Exported for testing only.
 */
export function isServerError(e: unknown): boolean {
  // ClickHouse server-side error type
  const chType = getClickHouseErrorType(e);
  if (chType && SERVER_CH_ERROR_TYPES.has(chType)) return true;

  // Node.js TCP/socket-level error. Walk the full cause chain because
  // common-utils' ClickHouseQueryError may nest the real TCP error
  // several levels deep.
  let current: unknown = e;
  const seen = new Set<unknown>(); // guard against circular .cause
  while (current instanceof Error) {
    if (seen.has(current)) break;
    seen.add(current);
    if (hasNodeErrorCode(current, SERVER_NODE_ERROR_CODES)) return true;
    // AggregateError.errors may hold the real TCP error
    if (
      current instanceof AggregateError &&
      current.errors.some(inner =>
        hasNodeErrorCode(inner, SERVER_NODE_ERROR_CODES),
      )
    ) {
      return true;
    }
    current = current.cause;
  }

  return false;
}

/** Type-safe check for a Node.js system error code on an unknown value. */
function hasNodeErrorCode(val: unknown, codes: ReadonlySet<string>): boolean {
  if (!(val instanceof Error)) return false;
  const code =
    'code' in val && typeof val.code === 'string' ? val.code : undefined;
  return code != null && codes.has(code);
}

/**
 * Decorate raw ClickHouse error messages with actionable guidance before
 * they reach the agent. Some ClickHouse errors are unhelpful in isolation —
 * e.g. "Cannot convert string '...Z' to type DateTime64(9)" leaves the agent
 * guessing about the right format. Catch common patterns and append a hint.
 *
 * ClickHouse query errors are classified as user errors by default since the
 * user/agent wrote the query that failed. Only infrastructure-level errors
 * (network, socket, connection failures) are classified as server errors.
 *
 * @param e        The caught error.
 * @param context  Optional message context. `prefix` is prepended (e.g.
 *                 "Failed to sample rows") and `suffix` is appended (e.g.
 *                 guidance about valid input). The categorization is derived
 *                 from the underlying ClickHouse error type regardless of the
 *                 surrounding context.
 */
export function clickHouseErrorResult(
  e: unknown,
  context?: string | { prefix?: string; suffix?: string },
): McpErrorResult {
  const { prefix, suffix } =
    typeof context === 'string'
      ? { prefix: context, suffix: undefined }
      : (context ?? {});

  // Prefer .message, but fall back to .cause.message when the wrapper
  // (e.g. ClickHouseQueryError from common-utils) has an empty message
  // and the real error details are in the cause chain.
  const raw =
    e instanceof Error
      ? e.message ||
        (e.cause instanceof Error ? e.cause.message : '') ||
        String(e)
      : String(e);
  const hint = errorHint(raw);
  const base = hint ? `${raw}\n\nHINT: ${hint}` : raw;
  const text = `${prefix ? `${prefix}: ` : ''}${base}${suffix ? ` ${suffix}` : ''}`;

  // Default to a user error — the user wrote the query that failed.
  // Only promote to a server error for known infrastructure error types
  // (ClickHouse server-side errors or TCP-level connection failures).
  return isServerError(e) ? mcpServerError(text) : mcpUserError(text);
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
