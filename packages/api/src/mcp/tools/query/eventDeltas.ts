import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  getStableSampleExpression,
  rankProperties,
} from '@hyperdx/common-utils/dist/core/eventDeltas';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  type BuilderChartConfigWithDateRange,
  DisplayType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { parseTimeRange } from './helpers';

// ─── Schema ──────────────────────────────────────────────────────────────────

const groupSchema = z.object({
  startTime: z.string().describe('Start of the group window as ISO 8601.'),
  endTime: z.string().describe('End of the group window as ISO 8601.'),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Optional row filter (Lucene by default, SQL via whereLanguage). ' +
        'Combined with the time window via AND. Useful for restricting the ' +
        'group to a service, endpoint, or other dimension.',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Query language for where. Default: lucene.'),
});

const deltasSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Source ID. Works for trace and log sources. ' +
        'Call hyperdx_list_sources for available sources.',
    ),
  target: groupSchema.describe(
    'Target ("outlier") group — the rows you suspect are different (e.g. the ' +
      'recent slow window, the failing requests, the affected segment).',
  ),
  baseline: groupSchema.describe(
    'Baseline ("inlier") group — the rows considered normal (e.g. an earlier ' +
      'healthy window, the successful requests, the unaffected segment).',
  ),
  sampleSize: z
    .number()
    .min(100)
    .max(5000)
    .optional()
    .default(500)
    .describe(
      'Rows to sample from each group. Default: 500. Larger samples give ' +
        'more stable rankings at the cost of latency.',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Number of top-ranked properties to return in `properties`. Default: 20.',
    ),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, include denylisted/high-cardinality properties in a separate ' +
        '`hidden` array. Default: false (mirrors UI behavior — these are noisy).',
    ),
  topValuesPerProperty: z
    .number()
    .min(2)
    .max(20)
    .optional()
    .default(6)
    .describe(
      'How many top values per property to include in the response. Default: 6.',
    ),
});

type DeltasInput = z.infer<typeof deltasSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function topDeltasForProperty(
  targetValues: Map<string, number>,
  baselineValues: Map<string, number>,
  targetTotal: number,
  baselineTotal: number,
  n: number,
): Array<{
  value: string;
  targetPct: number;
  baselinePct: number;
  diffPct: number;
}> {
  const allValues = new Set([...targetValues.keys(), ...baselineValues.keys()]);
  const out: Array<{
    value: string;
    targetPct: number;
    baselinePct: number;
    diffPct: number;
  }> = [];
  for (const value of allValues) {
    const tCount = targetValues.get(value) ?? 0;
    const bCount = baselineValues.get(value) ?? 0;
    const tPct = targetTotal > 0 ? (tCount / targetTotal) * 100 : 0;
    const bPct = baselineTotal > 0 ? (bCount / baselineTotal) * 100 : 0;
    out.push({
      value,
      targetPct: tPct,
      baselinePct: bPct,
      diffPct: tPct - bPct,
    });
  }
  out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return out.slice(0, n);
}

// ─── Tool definition ─────────────────────────────────────────────────────────

export function registerEventDeltas(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_event_deltas',
    {
      title: 'Compare Events: Target vs Baseline',
      description:
        'Rank the properties of two row groups (logs or trace spans) by ' +
        'how much their value distributions differ. Same algorithm as the ' +
        'in-app Event Deltas view (DBDeltaChart). High-cardinality fields ' +
        '(IDs, request IDs, timestamps) are filtered out by default so the ' +
        'ranking surfaces the categorical attributes that actually separate ' +
        'the two groups. Score is computed after normalizing each group to ' +
        "100% so it's robust to different group sizes.\n\n" +
        'USE THIS INSTEAD OF MANUAL PIVOTS. When two row sets visibly differ ' +
        "and you don't know which attribute(s) separate them, the standard " +
        'agentic move is to run a GROUP BY for each candidate attribute and ' +
        'compare. event_deltas does this for ALL attributes in one call, ' +
        'ranked by signal strength — usually 1 call instead of 5–20.\n\n' +
        'NARROW the target to the specific outlier rows. A broad target ' +
        'mostly contains healthy rows, so the ranking comes back noisy. ' +
        'The narrower target — the sharper the ranking.\n\n' +
        'TYPICAL USES (any source — logs or traces):\n' +
        '  - Slow vs fast spans (MOST COMMON for latency triage):\n' +
        '      target = {where: <op-filter> AND Duration > <threshold>},\n' +
        '      baseline = {where: <op-filter> AND Duration <= <threshold>}\n' +
        '      Scope BOTH to the same operation/endpoint via `<op-filter>`; ' +
        'the ranked attribute(s) are then what discriminates the slow ' +
        'invocations of THAT operation from the fast ones. Skipping the ' +
        'op-filter gives a noisy "which operation is slow" answer instead ' +
        'of "which sub-set of one operation is slow".\n' +
        '  - Before vs after a deploy / incident onset:\n' +
        '      target = {window: after onset}, baseline = {window: before onset}\n' +
        '  - Failing vs succeeding rows:\n' +
        '      target = {where: <failing filter>}, baseline = {where: <succeeding filter>}\n' +
        '  - One service / endpoint vs the rest:\n' +
        '      target = {where: ServiceName=X}, baseline = {where: ServiceName != X}\n' +
        '  Any pair of row sets over the same source works — the tool just ' +
        '  asks "what is statistically different about target vs baseline".\n\n' +
        'WHEN NOT TO USE: when the question is already known to be about a ' +
        'specific attribute (use hyperdx_table groupBy), when you want raw ' +
        'rows (use hyperdx_search), or when you need a time-series shape ' +
        '(use hyperdx_timeseries).\n\n' +
        'OUTPUT SHAPE: an array of properties, each with rank, key, score, ' +
        'semanticBoost (true for well-known OTel attrs like service.name / ' +
        'http.method / error.type / status), targetCount and baselineCount ' +
        '(sample sizes), and topDeltas — the values whose share shifted ' +
        'most, each with `value`, `targetPct`, `baselinePct`, and `diffPct`. ' +
        'topDeltas already contains the full per-value comparison for that ' +
        'attribute, so there is no separate target/baseline distribution to ' +
        'consult.\n\n' +
        'IMPORTANT — DO NOT STOP AT RANK 1. The top ~5 ranked properties ' +
        'are often INDEPENDENT axes that together explain the population ' +
        'shift (e.g. a regression localized on the intersection of two ' +
        'attributes). Scan down the list until the score visibly drops to ' +
        'noise level; any property well above that floor is a candidate axis ' +
        'to combine with the others.',
      inputSchema: deltasSchema,
    },
    withToolTracing(
      'hyperdx_event_deltas',
      context,
      async (input: DeltasInput) => {
        const targetRange = parseTimeRange(
          input.target.startTime,
          input.target.endTime,
        );
        if ('error' in targetRange) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `target: ${targetRange.error}`,
              },
            ],
          };
        }
        const baselineRange = parseTimeRange(
          input.baseline.startTime,
          input.baseline.endTime,
        );
        if ('error' in baselineRange) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `baseline: ${baselineRange.error}`,
              },
            ],
          };
        }

        // Refuse calls where target and baseline can't possibly produce a
        // meaningful comparison. The agent presumably wanted to write
        // something different on one side and didn't — flag it so the
        // round-trip is short instead of returning empty deltas.
        const targetWhere = (input.target.where ?? '').trim();
        const baselineWhere = (input.baseline.where ?? '').trim();
        const targetLang = input.target.whereLanguage ?? 'lucene';
        const baselineLang = input.baseline.whereLanguage ?? 'lucene';
        const sameWhere =
          targetWhere === baselineWhere && targetLang === baselineLang;
        const sameWindow =
          targetRange.startDate.getTime() ===
            baselineRange.startDate.getTime() &&
          targetRange.endDate.getTime() === baselineRange.endDate.getTime();
        if (sameWhere && sameWindow) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text:
                  'target and baseline are identical (same where + same time ' +
                  'window) — that yields nothing to compare. Pick distinct ' +
                  'groups: e.g. (a) before vs after a step change in time, ' +
                  '(b) failing rows vs succeeding rows, (c) slow spans ' +
                  '(Duration > X) vs fast spans (Duration <= X) in the same ' +
                  'window, or (d) one cohort vs the rest. At least one of ' +
                  '`where` or the time window must differ between the two ' +
                  'groups.',
              },
            ],
          };
        }

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
        if (
          source.kind !== SourceKind.Trace &&
          source.kind !== SourceKind.Log
        ) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Source ${input.sourceId} is kind="${source.kind}". hyperdx_event_deltas requires a trace or log source.`,
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

        // Build a stable per-source ORDER BY for sampling (matches what the
        // app does — uses spanIdExpression on traces, falls back to rand()).
        const stableSampleExpr =
          source.kind === SourceKind.Trace
            ? getStableSampleExpression(source.spanIdExpression)
            : 'rand()';

        const sampleSize = input.sampleSize;

        const buildSampleConfig = (
          group: { where: string; whereLanguage: 'lucene' | 'sql' },
          startDate: Date,
          endDate: Date,
        ): BuilderChartConfigWithDateRange => ({
          displayType: DisplayType.Search,
          // SELECT * so the algorithm sees all columns (it flattens nested
          // Maps/Arrays internally).
          select: '*',
          from: source.from,
          where: group.where,
          whereLanguage: group.where ? group.whereLanguage : 'sql',
          connection: source.connection.toString(),
          timestampValueExpression: source.timestampValueExpression,
          implicitColumnExpression:
            'implicitColumnExpression' in source
              ? source.implicitColumnExpression
              : undefined,
          orderBy: stableSampleExpr,
          limit: { limit: sampleSize },
          dateRange: [startDate, endDate],
        });

        const targetConfig = buildSampleConfig(
          input.target,
          targetRange.startDate,
          targetRange.endDate,
        );
        const baselineConfig = buildSampleConfig(
          input.baseline,
          baselineRange.startDate,
          baselineRange.endDate,
        );

        // Run renderChartConfig for both groups and getColumns in parallel —
        // they're independent and each hits ClickHouse metadata.
        let targetSql, baselineSql;
        let columnMeta: { name: string; type: string }[] = [];
        let columnMetaUnavailable = false;
        try {
          const [targetResult, baselineResult, colsResult] = await Promise.all([
            renderChartConfig(targetConfig, metadata, source.querySettings),
            renderChartConfig(baselineConfig, metadata, source.querySettings),
            metadata
              .getColumns({
                databaseName: source.from.databaseName,
                tableName: source.from.tableName,
                connectionId: source.connection.toString(),
              })
              .catch(() => null),
          ]);
          targetSql = targetResult;
          baselineSql = baselineResult;
          if (colsResult) {
            columnMeta = colsResult.map(c => ({
              name: c.name,
              type: c.type,
            }));
          } else {
            // Without column meta the algorithm just won't denylist anything —
            // not fatal, but signal it in the response so the agent knows
            // high-cardinality / ID fields may appear in the ranking.
            columnMetaUnavailable = true;
          }
        } catch (e) {
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Failed to build sample queries: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }

        let targetRows: Record<string, any>[];
        let baselineRows: Record<string, any>[];
        const abortController = new AbortController();
        try {
          const [targetRes, baselineRes] = await Promise.all([
            clickhouseClient.query({
              query: targetSql.sql,
              query_params: targetSql.params,
              format: 'JSON',
              connectionId: source.connection.toString(),
              clickhouse_settings: { max_execution_time: 30 },
              abort_signal: abortController.signal,
            }),
            clickhouseClient.query({
              query: baselineSql.sql,
              query_params: baselineSql.params,
              format: 'JSON',
              connectionId: source.connection.toString(),
              clickhouse_settings: { max_execution_time: 30 },
              abort_signal: abortController.signal,
            }),
          ]);
          const targetJson = (await (
            targetRes as { json: () => Promise<{ data: any[] }> }
          ).json()) ?? { data: [] };
          const baselineJson = (await (
            baselineRes as { json: () => Promise<{ data: any[] }> }
          ).json()) ?? { data: [] };
          targetRows = targetJson.data ?? [];
          baselineRows = baselineJson.data ?? [];
        } catch (e) {
          abortController.abort();
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text: `Failed to sample rows: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }

        const ranked = rankProperties({
          targetRows,
          baselineRows,
          columnMeta,
        });

        const visible = ranked.ranked.filter(p => !p.hidden);
        const hidden = ranked.ranked.filter(p => p.hidden);

        const renderEntry = (
          rank: number,
          p: (typeof ranked.ranked)[number],
        ) => {
          const tValues =
            ranked.targetStats.valueOccurences.get(p.key) ??
            new Map<string, number>();
          const bValues =
            ranked.baselineStats.valueOccurences.get(p.key) ??
            new Map<string, number>();
          const tTotal = ranked.targetStats.propertyOccurences.get(p.key) ?? 0;
          const bTotal =
            ranked.baselineStats.propertyOccurences.get(p.key) ?? 0;
          // Compact entry: topDeltas already contains every value's
          // target%/baseline%/diff%, so the previously-emitted nested
          // `target.topValues` / `baseline.topValues` were redundant
          // (~60% of the response payload). Keep the flat sample counts
          // so the agent can size-check the comparison.
          return {
            rank,
            key: p.key,
            score: p.score,
            semanticBoost: p.semanticBoost > 0,
            targetCount: tTotal,
            baselineCount: bTotal,
            ...(p.hidden ? { hiddenReason: p.hiddenReason } : {}),
            topDeltas: topDeltasForProperty(
              tValues,
              bValues,
              tTotal,
              bTotal,
              input.topValuesPerProperty,
            ),
          };
        };

        const properties = visible
          .slice(0, input.topN)
          .map((p, i) => renderEntry(i + 1, p));
        const hiddenEntries = input.includeHidden
          ? hidden
              .slice(0, input.topN)
              .map((p, i) => renderEntry(properties.length + i + 1, p))
          : undefined;

        const output = {
          summary: {
            sampleSize,
            targetSampleCount: targetRows.length,
            baselineSampleCount: baselineRows.length,
            propertiesScored: ranked.ranked.length,
            propertiesVisible: visible.length,
            propertiesHidden: hidden.length,
            ...(columnMetaUnavailable ? { columnMetaUnavailable: true } : {}),
            ...(targetRows.length === 0 || baselineRows.length === 0
              ? {
                  warning:
                    'One or both groups returned 0 rows — verify the time ' +
                    'window and where filter via hyperdx_search.',
                }
              : {}),
          },
          properties,
          ...(hiddenEntries ? { hidden: hiddenEntries } : {}),
          usage:
            'score is the maximum %-share difference of any value between target ' +
            'and baseline (after normalizing each group to 100%), plus a 0.1 ' +
            'tiebreaker boost for well-known OTel attributes. ' +
            'Properties with `semanticBoost: true` are well-known OTel attrs. ' +
            'Hidden properties (ID/timestamp arrays + high-cardinality fields) ' +
            'are dropped by default — set includeHidden:true to inspect them.',
        };

        const { data: trimmedOutput, isTrimmed } = trimToolResponse(output);

        const finalOutput = isTrimmed
          ? {
              ...trimmedOutput,
              note: 'Result was trimmed for context size. Narrow the time range, add filters, or reduce topN/topValuesPerProperty to reduce data.',
            }
          : trimmedOutput;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(finalOutput, null, 2),
            },
          ],
        };
      },
    ),
  );
}
