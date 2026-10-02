/**
 * clickstack_trace_top_time_consuming_operations
 *
 * Aggregate counterpart to clickstack_trace_waterfall. Given a parent-span
 * filter (a service + operation, optionally constrained to slow durations),
 * return the child operations consuming the most cumulative time across all
 * traces matching the parent filter — ranked by total_time_ms DESC.
 *
 * Same SQL pattern the in-app `ServiceDashboardEndpointPerformanceChart`
 * uses: subselect distinct TraceIds matching the parent, then aggregate
 * all spans in those traces, excluding the matching root.
 *
 * Why this exists: incident-triage agents that anchor on the first slow
 * endpoint they find need a way to ask "what's downstream of THIS slow
 * endpoint" without dropping into raw SQL with self-JOINs. The builder
 * tools (table / timeseries / search) can't express the TraceId subselect.
 */
import type { ChSql } from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { getSource } from '@/controllers/sources';
import {
  clickHouseErrorResult,
  isQueryOutOfTime,
  isServerError,
  parseTimeRange,
} from '@/mcp/tools/query/helpers';
import {
  TRACE_BREAKDOWN_DESCRIPTION,
  type TraceBreakdownInput,
  traceBreakdownSchema,
} from '@/mcp/tools/trace/breakdownSchema';
import {
  durationDivisor,
  getMcpClickhouseClient,
  inclusiveTimeFilter,
  mcpQuerySettings,
} from '@/mcp/tools/trace/shared';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

// The child stage looks spans up by TraceId, which is not in the sort key, so
// it reads every span in the window regardless of how few parents matched.
// Cost tracks the window length, so that is the first thing to shrink.
const TIMEOUT_SUFFIX =
  'This tool reads every span in the time window to find the children of ' +
  'matching traces, so cost grows with the window length. Retry with a ' +
  'shorter startTime/endTime window (e.g. 15-60 minutes around the ' +
  'incident), scope parentFilter to one ServiceName AND SpanName, set ' +
  'minParentDurationMs to break down only slow parents, or lower ' +
  'maxParentTraces.';

const INVALID_FILTER_SUFFIX =
  "The parentFilter must be valid ClickHouse SQL referencing columns on the trace table (e.g. ServiceName = 'X' AND SpanName = 'Y').";

export function registerTraceBreakdown({
  context,
  registerTool,
}: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_trace_top_time_consuming_operations',
    {
      title: 'Top Time-Consuming Operations Across Matching Traces',
      annotations: { readOnlyHint: true },
      description: TRACE_BREAKDOWN_DESCRIPTION,
      inputSchema: traceBreakdownSchema,
    },
    async (rawInput: TraceBreakdownInput) => {
      const input = traceBreakdownSchema.parse(rawInput);

      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      const source = await getSource(teamId.toString(), input.sourceId);
      if (!source) {
        return mcpUserError(
          `Source not found: ${input.sourceId}. Call clickstack_list_sources to find available source IDs.`,
        );
      }
      if (source.kind !== SourceKind.Trace) {
        return mcpUserError(
          `Source ${input.sourceId} is kind="${source.kind}". clickstack_trace_top_time_consuming_operations requires a source of kind="trace".`,
        );
      }

      const clickhouseClient = await getMcpClickhouseClient(
        teamId.toString(),
        source.connection.toString(),
      );
      if (!clickhouseClient) {
        return mcpUserError(
          `Connection not found for source: ${input.sourceId}`,
        );
      }

      const timeFilterParams = {
        connectionId: source.connection.toString(),
        databaseName: source.from.databaseName,
        tableName: source.from.tableName,
        timestampValueExpression: source.timestampValueExpression,
        metadata: getMetadata(clickhouseClient),
      };
      const renderTimeFilter = (start: number, end: number) =>
        inclusiveTimeFilter(timeFilterParams, new Date(start), new Date(end));
      let parentTimeFilter: ChSql;
      let childTimeFilter: ChSql;
      try {
        [parentTimeFilter, childTimeFilter] = await Promise.all([
          renderTimeFilter(startDate.getTime(), endDate.getTime()),
          // Widen the child window by 60s on each side to catch children
          // that started slightly before / ended slightly after the parent
          // sampling window.
          renderTimeFilter(
            startDate.getTime() - 60_000,
            endDate.getTime() + 60_000,
          ),
        ]);
      } catch (e) {
        // Only the DESCRIBE lookups run here; they don't depend on the window or
        // filters, so neither suffix applies.
        return clickHouseErrorResult(e, 'Failed to compute breakdown');
      }

      // Source-configured SQL expressions. These are trusted (set by the
      // team admin in source config) and we substitute them into the
      // generated SQL.
      const traceIdExpr = source.traceIdExpression;
      const spanNameExpr = source.spanNameExpression ?? "''";
      const serviceNameExpr = source.serviceNameExpression ?? "''";
      const durationExpr = source.durationExpression;
      const divisor = durationDivisor(source.durationPrecision);
      const dbName = source.from.databaseName;
      const tableName = source.from.tableName;

      // Build the SQL. parentFilter is SQL only (documented); time bounds
      // and topN/maxParentTraces are parameterized.
      // The CTE selects distinct parent TraceIds. The outer query joins
      // back, excludes the parent rows themselves (so we measure child
      // contribution), and aggregates by service+operation.
      const minDurationClause =
        input.minParentDurationMs != null
          ? `AND ${durationExpr} >= ({minParentDurationStored:Float64})`
          : '';

      const sql = `
WITH parent_traces AS (
  SELECT DISTINCT ${traceIdExpr} AS _trace_id
  FROM \`${dbName}\`.\`${tableName}\`
  WHERE ${parentTimeFilter.sql}
    AND (${input.parentFilter})
    ${minDurationClause}
  LIMIT {maxParentTraces:UInt32}
)
SELECT
  ${serviceNameExpr} AS service,
  ${spanNameExpr} AS operation,
  sum(${durationExpr}) / {divisor:Float64} AS total_time_ms,
  count() AS calls,
  uniqExact(${traceIdExpr}) AS in_parents,
  quantile(0.5)(${durationExpr}) / {divisor:Float64} AS p50_ms,
  quantile(0.99)(${durationExpr}) / {divisor:Float64} AS p99_ms
FROM \`${dbName}\`.\`${tableName}\`
WHERE ${traceIdExpr} IN (SELECT _trace_id FROM parent_traces)
  AND ${childTimeFilter.sql}
  AND NOT (${input.parentFilter})
GROUP BY service, operation
ORDER BY total_time_ms DESC
LIMIT {topN:UInt32}
        `;

      const params: Record<string, unknown> = {
        ...parentTimeFilter.params,
        ...childTimeFilter.params,
        maxParentTraces: input.maxParentTraces,
        topN: input.topN,
        divisor,
      };
      if (input.minParentDurationMs != null) {
        // Stored duration is divisor × ms.
        params.minParentDurationStored = input.minParentDurationMs * divisor;
      }

      type Row = {
        service: string;
        operation: string;
        total_time_ms: number | string;
        calls: number | string;
        in_parents: number | string;
        p50_ms: number | string;
        p99_ms: number | string;
      };

      let rows: Row[];
      try {
        const result = await clickhouseClient.query({
          query: sql,
          query_params: params,
          format: 'JSON',
          connectionId: source.connection.toString(),
          clickhouse_settings: mcpQuerySettings(source.querySettings),
        });
        const json = (await (
          result as { json: () => Promise<{ data: Row[] }> }
        ).json()) ?? { data: [] };
        rows = json.data ?? [];
      } catch (e) {
        return clickHouseErrorResult(e, {
          prefix: 'Failed to compute breakdown',
          suffix: isQueryOutOfTime(e)
            ? TIMEOUT_SUFFIX
            : isServerError(e)
              ? undefined
              : INVALID_FILTER_SUFFIX,
        });
      }

      // Normalise numerics — ClickHouse JSON sometimes returns strings for
      // 64-bit integers. Cast everything to Number and compute share of
      // total time at the same time.
      const operations = rows.map(r => ({
        service: r.service,
        operation: r.operation,
        totalTimeMs: Number(r.total_time_ms),
        calls: Number(r.calls),
        inParents: Number(r.in_parents),
        p50Ms: Number(r.p50_ms),
        p99Ms: Number(r.p99_ms),
      }));
      const grandTotalMs = operations.reduce(
        (acc, r) => acc + r.totalTimeMs,
        0,
      );
      const operationsWithShare = operations.map(r => ({
        ...r,
        shareOfTotalTime: grandTotalMs > 0 ? r.totalTimeMs / grandTotalMs : 0,
      }));

      const output = {
        summary: {
          parentFilter: input.parentFilter,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          minParentDurationMs: input.minParentDurationMs ?? null,
          operationsReturned: operationsWithShare.length,
          topN: input.topN,
          grandTotalTimeMs: grandTotalMs,
          hint:
            operationsWithShare.length === 0
              ? 'No matching parent traces, or all matching traces had no other spans. Widen the time window, relax the parentFilter, or lower minParentDurationMs.'
              : "Operations are sorted by total_time_ms (sum of child Duration). shareOfTotalTime is each row's share of the cumulative child time across all matching traces.",
        },
        operations: operationsWithShare,
      };

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    },
  );
}
