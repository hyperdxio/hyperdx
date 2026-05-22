/**
 * hyperdx_trace_top_time_consuming_operations
 *
 * Aggregate counterpart to hyperdx_trace_waterfall. Given a parent-span
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
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';

import { withToolTracing } from '../../utils/tracing';
import { parseTimeRange } from '../query/helpers';
import type { McpContext } from '../types';

// ─── Schema ──────────────────────────────────────────────────────────────────

const traceBreakdownSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Trace source ID. Must be a source of kind="trace". ' +
        'Call hyperdx_list_sources to find available sources.',
    ),
  parentFilter: z
    .string()
    .describe(
      'SQL WHERE clause that selects the PARENT spans you want to break ' +
        'down. The tool finds the distinct TraceIds matching this filter, ' +
        'then aggregates all spans within those traces. ' +
        'Use SQL syntax (not Lucene). Example: ' +
        "\"ServiceName = '<your-service>' AND SpanName = '<your-operation>'\".\n\n" +
        'SCOPE TO A SPECIFIC OPERATION, not just a service. A service-only ' +
        'filter mixes every endpoint together and returns whatever has the ' +
        "loudest child-time across all parents, which usually isn't what " +
        'you want. Always include a SpanName (or another operation-level ' +
        'discriminator). To compare two slow operations, call this tool ' +
        'once per operation and diff the results — two operations with ' +
        "similar p99 don't necessarily share a slow child.",
    ),
  startTime: z
    .string()
    .describe('Start of the parent-filter time window as ISO 8601. REQUIRED.'),
  endTime: z
    .string()
    .describe('End of the parent-filter time window as ISO 8601. REQUIRED.'),
  minParentDurationMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      'When set, only break down parent spans whose Duration ≥ this value. ' +
        'Use to focus the breakdown on slow parents (e.g. 1000 to only look ' +
        'at parents that took ≥ 1 second).',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Number of top operations to return, ranked by total_time_ms DESC. Default 20.',
    ),
  maxParentTraces: z
    .number()
    .min(100)
    .max(1_000_000)
    .optional()
    .default(100_000)
    .describe(
      'Safety cap on the number of distinct parent TraceIds considered. ' +
        'A breakdown over more than this many parent traces gets ' +
        'truncated to the first N. Default 100000.',
    ),
});

type TraceBreakdownInput = z.infer<typeof traceBreakdownSchema>;

// ─── Tool ────────────────────────────────────────────────────────────────────

function durationDivisor(precision: number): number {
  return Math.pow(10, Math.max(0, precision - 3));
}

export function registerTraceBreakdown(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_trace_top_time_consuming_operations',
    {
      title: 'Top Time-Consuming Operations Across Matching Traces',
      description:
        'Given a parent-span filter and a time window, return the child ' +
        'operations contributing the most cumulative time across all traces ' +
        'matching the parent filter. Same algorithm as the in-app ' +
        '"Top Most Time Consuming Operations" chart on the service dashboard.\n\n' +
        'WHAT IT DOES (two-stage, runs as one SQL):\n' +
        '  1. Pick distinct TraceIds where the parent span matches ' +
        '`parentFilter` in the window. Optionally restrict to ' +
        '`minParentDurationMs` to focus on slow parents.\n' +
        '  2. Aggregate ALL spans across those traces (excluding the ' +
        'matching root span itself) by (ServiceName, SpanName), ranked by ' +
        '`total_time_ms` DESC.\n\n' +
        'USE WHEN: investigating "where is the time going" for a slow ' +
        'operation. Filter to a specific (ServiceName, SpanName) pair and ' +
        'set `minParentDurationMs` to the threshold above which a parent ' +
        'span counts as "slow" for your investigation.\n\n' +
        'MULTIPLE OPERATIONS SLOW: when more than one operation shows ' +
        'elevated latency, call this tool ONCE PER (service, operation) ' +
        'and compare the top child rows across the result sets. Operations ' +
        'with the same top child likely share a cause; operations with ' +
        'different top children are independent regressions that happen ' +
        'to co-occur. DO NOT merge multiple operations into a single ' +
        'parentFilter — the cumulative rank then conflates independent ' +
        'investigations into one noisy answer.\n\n' +
        'RANKING METRIC: `total_time_ms = sum(Duration)` across all matching ' +
        'child spans. This captures the true contribution to elapsed time — ' +
        'a fast-but-frequent child can dominate the latency even if its p99 ' +
        'is unremarkable.\n\n' +
        'RETURNS: array of rows, each with `service`, `operation`, ' +
        '`total_time_ms`, `calls`, `in_parents` (how many parent traces ' +
        'contained at least one such span), `p50_ms`, `p99_ms`. Plus a ' +
        '`summary` block with the matched-parent count.\n\n' +
        'NEXT STEP after this tool: once a dominant slow child operation is ' +
        'identified, the canonical follow-up is hyperdx_event_deltas with ' +
        'slow-vs-fast spans of THAT child operation as target/baseline ' +
        "(target = {where: SpanName='<slow-child>' AND Duration > X}, " +
        "baseline = {where: SpanName='<slow-child>' AND Duration <= Y}). " +
        'The ranked attributes surface what distinguishes slow invocations ' +
        'of the child operation from fast ones.\n\n' +
        'CROSS-SERVICE BREAKDOWN: this tool does NOT scope children to the ' +
        "parent's service. Slow cross-service calls (database, cache, " +
        'upstream HTTP) surface naturally — useful for triage.\n\n' +
        'PAIR TOOL: hyperdx_trace_waterfall returns ONE concrete trace as a ' +
        "parent/child tree. Use it for an example after this tool's " +
        'aggregate breakdown has pointed you at the slow downstream operation.',
      inputSchema: traceBreakdownSchema,
    },
    withToolTracing(
      'hyperdx_trace_top_time_consuming_operations',
      context,
      async (rawInput: TraceBreakdownInput) => {
        const input = traceBreakdownSchema.parse(rawInput);

        const timeRange = parseTimeRange(input.startTime, input.endTime);
        if ('error' in timeRange) {
          return {
            isError: true as const,
            content: [{ type: 'text' as const, text: timeRange.error }],
          };
        }
        const { startDate, endDate } = timeRange;

        const source = await getSource(teamId.toString(), input.sourceId);
        if (!source) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Source not found: ${input.sourceId}. Call hyperdx_list_sources to find available source IDs.`,
              },
            ],
          };
        }
        if (source.kind !== SourceKind.Trace) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Source ${input.sourceId} is kind="${source.kind}". hyperdx_trace_top_time_consuming_operations requires a source of kind="trace".`,
              },
            ],
          };
        }

        const connection = await getConnectionById(
          teamId.toString(),
          source.connection.toString(),
          true,
        );
        if (!connection) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Connection not found for source: ${input.sourceId}`,
              },
            ],
          };
        }

        // Source-configured SQL expressions. These are trusted (set by the
        // team admin in source config) and we substitute them into the
        // generated SQL.
        const tsExpr = source.timestampValueExpression;
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
  WHERE ${tsExpr} >= fromUnixTimestamp64Milli({startMs:Int64})
    AND ${tsExpr} <= fromUnixTimestamp64Milli({endMs:Int64})
    AND (${input.parentFilter})
    ${minDurationClause}
  LIMIT {maxParentTraces:UInt32}
)
SELECT
  ${serviceNameExpr} AS service,
  ${spanNameExpr} AS operation,
  sum(${durationExpr}) / {divisor:Float64} AS total_time_ms,
  count() AS calls,
  count(DISTINCT ${traceIdExpr}) AS in_parents,
  quantile(0.5)(${durationExpr}) / {divisor:Float64} AS p50_ms,
  quantile(0.99)(${durationExpr}) / {divisor:Float64} AS p99_ms
FROM \`${dbName}\`.\`${tableName}\`
WHERE ${traceIdExpr} IN (SELECT _trace_id FROM parent_traces)
  AND ${tsExpr} >= fromUnixTimestamp64Milli({wideStartMs:Int64})
  AND ${tsExpr} <= fromUnixTimestamp64Milli({wideEndMs:Int64})
  AND NOT (${input.parentFilter})
GROUP BY service, operation
ORDER BY total_time_ms DESC
LIMIT {topN:UInt32}
        `;

        const params: Record<string, unknown> = {
          startMs: startDate.getTime(),
          endMs: endDate.getTime(),
          // Widen the child window by 60s on each side to catch children
          // that started slightly before / ended slightly after the parent
          // sampling window.
          wideStartMs: startDate.getTime() - 60_000,
          wideEndMs: endDate.getTime() + 60_000,
          maxParentTraces: input.maxParentTraces,
          topN: input.topN,
          divisor,
        };
        if (input.minParentDurationMs != null) {
          // Stored duration is divisor × ms.
          params.minParentDurationStored = input.minParentDurationMs * divisor;
        }

        const clickhouseClient = new ClickhouseClient({
          host: connection.host,
          username: connection.username,
          password: connection.password,
        });

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
            clickhouse_settings: {
              // Prevent DDL/DML injection via parentFilter — only SELECTs allowed.
              readonly: '1',
              ...(source.querySettings
                ? Object.fromEntries(
                    source.querySettings.map(s => [s.setting, s.value]),
                  )
                : {}),
            },
          });
          const json = (await (
            result as { json: () => Promise<{ data: Row[] }> }
          ).json()) ?? { data: [] };
          rows = json.data ?? [];
        } catch (e) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Failed to compute breakdown: ${e instanceof Error ? e.message : String(e)}. The parentFilter must be valid ClickHouse SQL referencing columns on the trace table (e.g. ServiceName = 'X' AND SpanName = 'Y').`,
              },
            ],
          };
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
    ),
  );
}
