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
import { z } from 'zod';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { MCP_QUERY_MAX_EXECUTION_SEC } from '@/mcp/utils/timeout';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { PREFER_BUILDER_OVER_SQL_NUDGE } from './builderCatalog';
import { clickHouseErrorResult, parseTimeRange } from './helpers';

// ─── Schema ──────────────────────────────────────────────────────────────────

const makeGroupSchema = (text: {
  startTime: string;
  endTime: string;
  where: string;
}) =>
  z.object({
    startTime: z.string().describe(text.startTime),
    endTime: z.string().describe(text.endTime),
    where: z.string().optional().default('').describe(text.where),
    whereLanguage: z
      .enum(['lucene', 'sql'])
      .optional()
      .default('lucene')
      .describe(
        "Language of where. Lucene uses Column:value; SQL uses Column = 'value'.",
      ),
  });

const deltasSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Trace or log source to sample. ' +
        'Call clickstack_list_sources for available sources.',
    ),
  target: makeGroupSchema({
    startTime: 'Start of the target window as ISO 8601.',
    endTime: 'End of the target window as ISO 8601.',
    where:
      'Row filter selecting the target rows, ANDed with the target window. ' +
      'Keep it narrow: only the outlier rows. For slow-vs-fast comparisons, ' +
      'include the same operation filter used in baseline.',
  }).describe(
    'Target ("outlier") group — the rows you suspect are different (e.g. the ' +
      'recent slow window, the failing requests, the affected segment).',
  ),
  baseline: makeGroupSchema({
    startTime:
      'Start of the baseline window as ISO 8601. Use an earlier healthy ' +
      'period for before/after comparisons, or the same window as target ' +
      'when the groups differ only by where.',
    endTime: 'End of the baseline window as ISO 8601.',
    where:
      'Row filter selecting the baseline rows, ANDed with the baseline ' +
      'window. Leave empty to use every row in the window. If where and ' +
      'whereLanguage match target, the windows must differ.',
  }).describe(
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
      'Rows to sample from each group. Larger samples give more stable ' +
        'rankings at the cost of latency.',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Number of top-ranked properties to return in `properties` (and in ' +
        '`hidden` when includeHidden is set).',
    ),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Also return denylisted ID, timestamp, and high-cardinality properties ' +
        'in a separate `hidden` array. Off by default, like the UI, because ' +
        'these are noisy.',
    ),
  topValuesPerProperty: z
    .number()
    .min(2)
    .max(20)
    .optional()
    .default(6)
    .describe(
      'Number of values per property in `topDeltas`, ordered by largest ' +
        'share shift.',
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

export function registerEventDeltas({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_event_deltas',
    {
      title: 'Compare Events: Target vs Baseline',
      annotations: READ_ONLY_TOOL,
      description:
        'Rank every attribute of two row groups (logs or trace spans) by how ' +
        'much its value distribution differs between a target and a baseline ' +
        '(the in-app Event Deltas algorithm). One call replaces running a ' +
        'GROUP BY per candidate attribute.\n\n' +
        'NARROW the target to the outlier rows. A broad target is mostly ' +
        'healthy rows and gives a noisy ranking. target and baseline must ' +
        'differ in where or in time window.\n\n' +
        'TYPICAL PAIRS:\n' +
        '  - Slow vs fast (latency triage): target where = <op-filter> AND ' +
        'Duration > X, baseline where = <op-filter> AND Duration <= X. Scope ' +
        'BOTH to the same operation, or you learn which operation is slow ' +
        'instead of why it is slow.\n' +
        '  - After vs before an incident or deploy: same where, different windows.\n' +
        '  - Failing vs succeeding rows, or one service vs the rest.\n\n' +
        'WHEN NOT TO USE: the attribute is already known (clickstack_table ' +
        'groupBy), you want raw rows (clickstack_search) or a trend ' +
        '(clickstack_timeseries), or you want patterns that are new or gone ' +
        '(clickstack_emerging_signals).\n\n' +
        PREFER_BUILDER_OVER_SQL_NUDGE +
        '\n\n' +
        'OUTPUT: properties ranked by score, the largest %-share difference of ' +
        'any value after normalizing each group to 100%, plus a 0.1 tie-breaking ' +
        'boost for well-known attributes. Each has key, score, ' +
        'semanticBoost (well-known OTel attribute), targetCount/baselineCount, ' +
        'and topDeltas (value, targetPct, baselinePct, diffPct): the ' +
        'topValuesPerProperty values whose share shifted most. ID and high-cardinality fields are hidden ' +
        'unless includeHidden is set.\n\n' +
        'DO NOT STOP AT RANK 1. The top ~5 are often independent axes that ' +
        'together explain the shift. Read down until scores drop to noise.',
      inputSchema: deltasSchema,
    },
    async (input: DeltasInput) => {
      const targetRange = parseTimeRange(
        input.target.startTime,
        input.target.endTime,
      );
      if ('error' in targetRange) {
        return mcpUserError(`target: ${targetRange.error}`);
      }
      const baselineRange = parseTimeRange(
        input.baseline.startTime,
        input.baseline.endTime,
      );
      if ('error' in baselineRange) {
        return mcpUserError(`baseline: ${baselineRange.error}`);
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
        targetRange.startDate.getTime() === baselineRange.startDate.getTime() &&
        targetRange.endDate.getTime() === baselineRange.endDate.getTime();
      if (sameWhere && sameWindow) {
        return mcpUserError(
          'target and baseline are identical (same where + same time ' +
            'window) — that yields nothing to compare. Pick distinct ' +
            'groups: e.g. (a) before vs after a step change in time, ' +
            '(b) failing rows vs succeeding rows, (c) slow spans ' +
            '(Duration > X) vs fast spans (Duration <= X) in the same ' +
            'window, or (d) one cohort vs the rest. At least one of ' +
            '`where` or the time window must differ between the two ' +
            'groups.',
        );
      }

      const source = await getSource(teamId.toString(), input.sourceId);
      if (!source) {
        return mcpUserError(
          `Source not found: ${input.sourceId}. Call clickstack_list_sources to find available source IDs.`,
        );
      }
      if (source.kind !== SourceKind.Trace && source.kind !== SourceKind.Log) {
        return mcpUserError(
          `Source ${input.sourceId} is kind="${source.kind}". clickstack_event_deltas requires a trace or log source.`,
        );
      }

      const connection = await getConnectionById(
        teamId.toString(),
        source.connection.toString(),
        true,
      );
      if (!connection) {
        return mcpUserError(
          `Connection not found for source: ${input.sourceId}`,
        );
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
        return clickHouseErrorResult(e, 'Failed to build sample queries');
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
            clickhouse_settings: {
              max_execution_time: MCP_QUERY_MAX_EXECUTION_SEC,
            },
            abort_signal: abortController.signal,
          }),
          clickhouseClient.query({
            query: baselineSql.sql,
            query_params: baselineSql.params,
            format: 'JSON',
            connectionId: source.connection.toString(),
            clickhouse_settings: {
              max_execution_time: MCP_QUERY_MAX_EXECUTION_SEC,
            },
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
        return clickHouseErrorResult(e, 'Failed to sample rows');
      }

      const ranked = rankProperties({
        targetRows,
        baselineRows,
        columnMeta,
      });

      const visible = ranked.ranked.filter(p => !p.hidden);
      const hidden = ranked.ranked.filter(p => p.hidden);

      const renderEntry = (rank: number, p: (typeof ranked.ranked)[number]) => {
        const tValues =
          ranked.targetStats.valueOccurences.get(p.key) ??
          new Map<string, number>();
        const bValues =
          ranked.baselineStats.valueOccurences.get(p.key) ??
          new Map<string, number>();
        const tTotal = ranked.targetStats.propertyOccurences.get(p.key) ?? 0;
        const bTotal = ranked.baselineStats.propertyOccurences.get(p.key) ?? 0;
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
                  'window and where filter via clickstack_search.',
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
  );
}
