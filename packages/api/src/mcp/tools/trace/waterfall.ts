import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  type BuilderChartConfigWithDateRange,
  type ChartConfigWithDateRange,
  DisplayType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { parseTimeRange } from '@/mcp/tools/query/helpers';
import type { ToolRegistrar } from '@/mcp/tools/types';

// ─── Schema ──────────────────────────────────────────────────────────────────

const traceSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Trace source ID. Must be a source of kind "trace". ' +
        'Call clickstack_list_sources to find available sources.',
    ),
  traceId: z
    .string()
    .optional()
    .describe(
      'Specific TraceId to look up. When provided, the tool fetches every span ' +
        'in this trace and returns them as a parent/child tree. ' +
        'When omitted, the tool auto-picks one trace using pickFilter + pickBy.',
    ),
  pickFilter: z
    .string()
    .optional()
    .default('')
    .describe(
      'Filter (Lucene by default, SQL via pickFilterLanguage) used to narrow which ' +
        'trace to auto-pick when traceId is not provided. ' +
        'Example shapes (Lucene): `ServiceName:<some-service>`, ' +
        '`ServiceName:<svc> AND SpanName:"<some-operation>"`, ' +
        '`StatusCode:<status-value>` (status values come from the source ' +
        "schema's keyColumns). Ignored when traceId is provided.",
    ),
  pickFilterLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Query language for pickFilter. Default: lucene'),
  pickBy: z
    .enum(['slowest', 'first_error', 'most_recent'])
    .optional()
    .default('slowest')
    .describe(
      'How to choose which trace to return when traceId is not provided.\n' +
        '  slowest – trace with the longest single span (use for latency investigations)\n' +
        '  first_error – earliest trace containing a span with STATUS_CODE_ERROR\n' +
        '  most_recent – the most recent trace matching pickFilter',
    ),
  startTime: z
    .string()
    .optional()
    .describe(
      'Start of the search window as ISO 8601. Default: 15 minutes ago.',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the search window as ISO 8601. Default: now.'),
  maxSpans: z
    .number()
    .min(1)
    .max(2000)
    .optional()
    .default(500)
    .describe(
      'Cap on spans returned in the tree (1–2000). Default 500. ' +
        'A trace with more spans than this will be truncated; the response notes the truncation.',
    ),
  includeLogs: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true and the trace source has a linked logSourceId, also fetch ' +
        'log rows that share the same TraceId and inline them in the response ' +
        'as `logs[]`. Each log row carries its spanId so the agent can ' +
        'attribute messages to specific spans. No-op if the trace source has ' +
        'no logSourceId configured.',
    ),
  maxLogs: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .default(100)
    .describe(
      'Cap on correlated log rows returned (1–1000). Default 100. Has no ' +
        'effect when includeLogs is false or the trace source has no logSourceId.',
    ),
});

type TraceInput = z.infer<typeof traceSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type SpanRow = {
  spanId: string;
  parentSpanId: string;
  serviceName: string;
  spanName: string;
  spanKind: string;
  durationMs: number;
  statusCode: string;
  statusMessage: string;
  timestamp: string;
  spanAttributes: Record<string, string>;
};

type TreeSpan = SpanRow & { depth: number };

function buildPreOrderTree(spans: SpanRow[]): TreeSpan[] {
  // Map child spans by their parentSpanId. A span with no matching parent in
  // the result set is treated as a root (typical when the trace was truncated
  // mid-tree, or for the actual root span which has parentSpanId = '').
  const childrenByParent = new Map<string, SpanRow[]>();
  const idsInResult = new Set(spans.map(s => s.spanId));
  const roots: SpanRow[] = [];
  for (const s of spans) {
    const parentInResult = idsInResult.has(s.parentSpanId);
    if (!parentInResult) {
      roots.push(s);
      continue;
    }
    const list = childrenByParent.get(s.parentSpanId) ?? [];
    list.push(s);
    childrenByParent.set(s.parentSpanId, list);
  }

  // Sort each level by timestamp so the tree reads in execution order.
  const sortByTimestamp = (a: SpanRow, b: SpanRow) =>
    a.timestamp.localeCompare(b.timestamp);
  roots.sort(sortByTimestamp);
  for (const list of childrenByParent.values()) list.sort(sortByTimestamp);

  const ordered: TreeSpan[] = [];
  const visit = (span: SpanRow, depth: number) => {
    ordered.push({ ...span, depth });
    const children = childrenByParent.get(span.spanId) ?? [];
    for (const c of children) visit(c, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  return ordered;
}

function durationDivisor(precision: number): number {
  // durationPrecision is the number of decimal digits in the stored value.
  // precision=9 → ns (divide by 1e6 for ms), precision=6 → µs (divide by 1e3),
  // precision=3 → already ms (divide by 1).
  return Math.pow(10, Math.max(0, precision - 3));
}

// ─── Tool definition ─────────────────────────────────────────────────────────

export function registerTraceWaterfall({
  context,
  registerTool,
}: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_trace_waterfall',
    {
      title: 'Trace Waterfall (single trace)',
      description:
        'Fetch all spans in ONE trace and return them as a parent/child waterfall, ' +
        'pre-ordered for human-readable display. Use this for "show me a concrete ' +
        'example trace" or "what happened in trace X" investigations — the tool walks ' +
        'the cascade for you instead of forcing the model to write self-JOINs in raw SQL.\n\n' +
        'NOT THE RIGHT TOOL when the question is "where does the time go across MANY ' +
        'slow traces of operation X" — that is the aggregate question, and the answer ' +
        'is clickstack_trace_top_time_consuming_operations (called per affected ' +
        '(service, operation) with `minParentDurationMs`). Use this tool only when you ' +
        'want a single concrete example to inspect, or after the aggregate breakdown ' +
        'has already identified a suspicious operation.\n\n' +
        'Two modes:\n' +
        '  1. Specific trace: pass `traceId`. Returns every span in that trace.\n' +
        '  2. Auto-pick: pass `pickFilter` + `pickBy`. The tool finds one matching trace ' +
        '(slowest / first_error / most_recent) and returns its full tree.\n\n' +
        'Each returned span has: depth (root=0), spanId, parentSpanId, serviceName, ' +
        'spanName, spanKind, durationMs, statusCode, statusMessage, timestamp, and ' +
        'spanAttributes. Spans are pre-order DFS — child spans follow their parent in ' +
        'execution order. The tool also surfaces a `summary` section with the picked ' +
        'TraceId, total span count, and root span info.\n\n' +
        'When the trace source has a linked logSourceId (the standard config), the ' +
        'response also includes a `logs[]` array of correlated log rows that share ' +
        'the same TraceId — sorted by timestamp, each carrying its `spanId` so the ' +
        'agent can attribute messages to specific spans. Disable with `includeLogs:false`.\n\n' +
        "Prefer this over running raw SQL with JOINs on TraceId — it uses the source's " +
        'configured traceIdExpression / parentSpanIdExpression / spanIdExpression so ' +
        'attribute extraction stays consistent with the rest of the platform.\n\n' +
        'PAIR TOOL: clickstack_trace_top_time_consuming_operations is the aggregate ' +
        'counterpart — given a parent-span filter, it ranks child operations by total ' +
        'time across MANY matching traces. Use that when the question is "where does ' +
        'time go in slow X" (aggregate), and use THIS tool when the question is "show ' +
        'me one example of a slow X" (single trace).',
      inputSchema: traceSchema,
    },
    async (rawInput: TraceInput) => {
      const input = traceSchema.parse(rawInput);
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
              text: `Source not found: ${input.sourceId}. Call clickstack_list_sources to find available source IDs.`,
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
              text: `Source ${input.sourceId} is kind="${source.kind}". clickstack_trace_waterfall requires a source of kind="trace".`,
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

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });
      const metadata = getMetadata(clickhouseClient);

      const traceIdExpr = source.traceIdExpression;
      const spanIdExpr = source.spanIdExpression;
      const parentSpanIdExpr = source.parentSpanIdExpression;
      const spanNameExpr = source.spanNameExpression;
      const spanKindExpr = source.spanKindExpression;
      const durationExpr = source.durationExpression;
      const tsExpr = source.timestampValueExpression;
      const serviceNameExpr = source.serviceNameExpression ?? "''";
      const statusCodeExpr = source.statusCodeExpression ?? "''";
      const statusMessageExpr = source.statusMessageExpression ?? "''";
      const attrsExpr = source.eventAttributesExpression ?? 'map()';
      const divisor = durationDivisor(source.durationPrecision);

      // ── Step 1: pick a TraceId (unless one was provided) ──
      let pickedTraceId = input.traceId;
      if (!pickedTraceId) {
        // Compose pickFilter with the pickBy-specific filter when needed.
        let effectiveFilter = input.pickFilter;
        let effectiveLanguage = input.pickFilterLanguage;
        if (input.pickBy === 'first_error') {
          // Statuses are typically stored as enum strings. Use SQL so we don't
          // depend on lucene mapping the raw column name.
          const errFilter = `${statusCodeExpr} = 'STATUS_CODE_ERROR'`;
          if (effectiveFilter && effectiveLanguage === 'sql') {
            effectiveFilter = `(${effectiveFilter}) AND (${errFilter})`;
          } else if (effectiveFilter && effectiveLanguage === 'lucene') {
            // Run lucene filter inside parens, AND with raw SQL.
            // Easiest: convert to sql by AND-joining a fresh sql-only condition
            // means we'd have to render lucene first. Compromise: tell user
            // to express the error filter in pickFilter directly.
            effectiveFilter = `(${effectiveFilter}) AND StatusCode:STATUS_CODE_ERROR`;
            effectiveLanguage = 'lucene';
          } else {
            effectiveFilter = errFilter;
            effectiveLanguage = 'sql';
          }
        }

        const orderBy =
          input.pickBy === 'slowest'
            ? `max(${durationExpr}) DESC`
            : input.pickBy === 'first_error'
              ? `min(${tsExpr}) ASC`
              : `max(${tsExpr}) DESC`;

        const pickConfig: BuilderChartConfigWithDateRange = {
          displayType: DisplayType.Table,
          select: [
            {
              aggFn: 'count' as const,
              valueExpression: '',
              alias: 'span_count',
              aggCondition: '',
              aggConditionLanguage: 'sql' as const,
            },
          ],
          from: source.from,
          where: effectiveFilter,
          whereLanguage: effectiveLanguage,
          connection: source.connection.toString(),
          timestampValueExpression: tsExpr,
          implicitColumnExpression: source.implicitColumnExpression,
          groupBy: traceIdExpr,
          orderBy,
          limit: { limit: 1 },
          dateRange: [startDate, endDate],
        };

        let pickResult: { data?: Array<Record<string, unknown>> } = {};
        try {
          pickResult = (await clickhouseClient.queryChartConfig({
            config: pickConfig as ChartConfigWithDateRange,
            metadata,
            querySettings: source.querySettings,
          })) as { data?: Array<Record<string, unknown>> };
        } catch (e) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Failed to pick a trace: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }

        const firstRow = pickResult.data?.[0];
        if (!firstRow) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    result: null,
                    hint:
                      'No traces matched. Widen the time range, relax pickFilter, or ' +
                      'pass a specific traceId.',
                    pickFilter: effectiveFilter,
                    pickBy: input.pickBy,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        // The grouped traceId column is rendered into the result with the
        // expression text as its alias. Locate it by stripping non-data keys.
        const candidate = Object.entries(firstRow).find(
          ([k]) => k !== 'span_count' && k !== '__hdx_time_bucket',
        );
        if (!candidate || candidate[1] == null) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Picker returned a row but no TraceId column was found. Row keys: ${Object.keys(firstRow).join(', ')}`,
              },
            ],
          };
        }
        pickedTraceId = String(candidate[1]);
      }

      // ── Step 2: fetch the full span tree ──
      const treeQuery = `
        SELECT
          ${spanIdExpr} AS spanId,
          ${parentSpanIdExpr} AS parentSpanId,
          ${serviceNameExpr} AS serviceName,
          ${spanNameExpr} AS spanName,
          ${spanKindExpr} AS spanKind,
          ${durationExpr} / {divisor:Float64} AS durationMs,
          ${statusCodeExpr} AS statusCode,
          ${statusMessageExpr} AS statusMessage,
          ${tsExpr} AS timestamp,
          ${attrsExpr} AS spanAttributes
        FROM {db:Identifier}.{tbl:Identifier}
        WHERE ${traceIdExpr} = {tid:String}
        ORDER BY ${tsExpr} ASC
        LIMIT {n:UInt32}
      `;

      let rows: SpanRow[];
      try {
        const result = await clickhouseClient.query({
          query: treeQuery,
          query_params: {
            db: source.from.databaseName,
            tbl: source.from.tableName,
            tid: pickedTraceId,
            n: input.maxSpans + 1, // +1 to detect truncation
            divisor,
          },
          format: 'JSONEachRow',
          connectionId: source.connection.toString(),
          clickhouse_settings: {
            readonly: '1',
            // Per-query timeout matches the rest of the MCP for consistency.
            ...(source.querySettings
              ? Object.fromEntries(
                  source.querySettings.map(s => [s.setting, s.value]),
                )
              : {}),
          },
        });
        rows =
          (await (result as { json: () => Promise<SpanRow[]> }).json()) ?? [];
      } catch (e) {
        return {
          isError: true as const,
          content: [
            {
              type: 'text' as const,
              text: `Failed to fetch trace ${pickedTraceId}: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        };
      }

      const truncated = rows.length > input.maxSpans;
      const spans = truncated ? rows.slice(0, input.maxSpans) : rows;

      if (spans.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  result: null,
                  traceId: pickedTraceId,
                  hint: 'TraceId picked, but no spans exist in the time window. The trace may have spans outside startTime/endTime — widen the window.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const tree = buildPreOrderTree(spans);
      const root = tree.find(s => s.depth === 0) ?? tree[0];
      const totalDuration = Math.max(...spans.map(s => s.durationMs));

      // ── Step 3: fetch correlated logs (when logSourceId is configured) ──
      type LogRow = {
        timestamp: string;
        severityText: string;
        body: string;
        serviceName: string;
        spanId: string;
      };
      let correlatedLogs: LogRow[] | undefined;
      let logsTruncated = false;
      let logsNote: string | undefined;
      if (input.includeLogs && source.logSourceId) {
        const logSource = await getSource(
          teamId.toString(),
          source.logSourceId,
        );
        if (!logSource) {
          logsNote = `logSourceId ${source.logSourceId} configured but source not found`;
        } else if (logSource.kind !== SourceKind.Log) {
          logsNote = `logSourceId ${source.logSourceId} is kind="${logSource.kind}", not "log"`;
        } else {
          const logTraceIdExpr = logSource.traceIdExpression ?? 'TraceId';
          const logSpanIdExpr = logSource.spanIdExpression ?? "''";
          const logTsExpr = logSource.timestampValueExpression;
          const logBodyExpr = logSource.bodyExpression ?? "''";
          const logSevExpr = logSource.severityTextExpression ?? "''";
          const logSvcExpr = logSource.serviceNameExpression ?? "''";

          // Reuse the same connection only when the log source lives there.
          let logClient = clickhouseClient;
          if (
            logSource.connection.toString() !== source.connection.toString()
          ) {
            const logConn = await getConnectionById(
              teamId.toString(),
              logSource.connection.toString(),
              true,
            );
            if (!logConn) {
              logsNote = `connection for log source ${source.logSourceId} not found`;
            } else {
              logClient = new ClickhouseClient({
                host: logConn.host,
                username: logConn.username,
                password: logConn.password,
              });
            }
          }

          if (!logsNote) {
            const logsQuery = `
              SELECT
                ${logTsExpr} AS timestamp,
                ${logSevExpr} AS severityText,
                ${logBodyExpr} AS body,
                ${logSvcExpr} AS serviceName,
                ${logSpanIdExpr} AS spanId
              FROM {db:Identifier}.{tbl:Identifier}
              WHERE ${logTraceIdExpr} = {tid:String}
              ORDER BY ${logTsExpr} ASC
              LIMIT {n:UInt32}
            `;
            try {
              const logResult = await logClient.query({
                query: logsQuery,
                query_params: {
                  db: logSource.from.databaseName,
                  tbl: logSource.from.tableName,
                  tid: pickedTraceId,
                  n: input.maxLogs + 1, // +1 to detect truncation
                },
                format: 'JSONEachRow',
                connectionId: logSource.connection.toString(),
                clickhouse_settings: {
                  readonly: '1',
                  ...(logSource.querySettings
                    ? Object.fromEntries(
                        logSource.querySettings.map(s => [s.setting, s.value]),
                      )
                    : {}),
                },
              });
              const allLogs =
                (await (
                  logResult as { json: () => Promise<LogRow[]> }
                ).json()) ?? [];
              logsTruncated = allLogs.length > input.maxLogs;
              correlatedLogs = logsTruncated
                ? allLogs.slice(0, input.maxLogs)
                : allLogs;
            } catch (e) {
              logsNote = `Failed to fetch correlated logs: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }
      }

      const output = {
        traceId: pickedTraceId,
        spanCount: spans.length,
        totalDurationMs: totalDuration,
        rootSpan: {
          spanId: root.spanId,
          serviceName: root.serviceName,
          spanName: root.spanName,
          durationMs: root.durationMs,
          statusCode: root.statusCode,
        },
        spans: tree,
        ...(correlatedLogs
          ? {
              logs: correlatedLogs,
              logsCount: correlatedLogs.length,
              ...(logsTruncated
                ? {
                    logsNote: `Logs truncated to ${input.maxLogs}. Increase maxLogs (max 1000) if needed.`,
                  }
                : {}),
            }
          : {}),
        ...(logsNote ? { logsNote } : {}),
        ...(truncated
          ? {
              note: `Result truncated to ${input.maxSpans} spans. Increase maxSpans (max 2000) or narrow the trace if needed.`,
            }
          : {}),
      };

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    },
  );
}
