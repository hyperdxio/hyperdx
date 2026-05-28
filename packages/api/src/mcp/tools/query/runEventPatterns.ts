import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import { minePatterns } from '@hyperdx/common-utils/dist/drain';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { clickHouseErrorResult } from './helpers';

// ─── Source helpers ──────────────────────────────────────────────────────────

interface SourceBodyFields {
  kind: string;
  spanNameExpression?: string;
  bodyExpression?: string;
  implicitColumnExpression?: string;
}

/**
 * Resolve the body column expression for pattern mining from a source.
 * Mirrors the web app's getEventBody() logic (packages/app/src/source.ts).
 */
function resolveBodyExpression(source: SourceBodyFields): string | undefined {
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
const SAFE_BODY_EXPR_CHARS = /^[\w.':\[\]\-]+$/;

// ─── Event pattern mining ────────────────────────────────────────────────────

export async function runEventPatterns(
  teamId: string,
  sourceId: string,
  startDate: Date,
  endDate: Date,
  options?: {
    where?: string;
    whereLanguage?: 'lucene' | 'sql';
    bodyExpression?: string;
    sampleSize?: number;
    topN?: number;
    trendBuckets?: number;
  },
) {
  const sampleSize = options?.sampleSize ?? 10_000;
  const topN = options?.topN ?? 20;
  const trendBuckets = options?.trendBuckets ?? 24;

  // ── Resolve source & connection ──
  const source = await getSource(teamId, sourceId);
  if (!source) {
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: `Source not found: ${sourceId}. Call hyperdx_list_sources to discover available source IDs.`,
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
          text: `Connection not found for source: ${sourceId}. Call hyperdx_list_sources to discover available source IDs.`,
        },
      ],
    };
  }

  // ── Determine body column ──
  // Sanitize caller-supplied bodyExpression: must be a single column reference
  // matching the documented format (e.g. "Body", "SpanAttributes['http.url']").
  // The allowlist rejects injection attempts like "Body) OR (1=1".
  let bodyColumn: string | undefined;
  if (options?.bodyExpression) {
    const parts = splitAndTrimWithBracket(options.bodyExpression);
    if (parts.length !== 1 || !SAFE_BODY_EXPR_CHARS.test(parts[0])) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text:
              'bodyExpression must be a single column expression ' +
              '(e.g. "Body", "SpanName", "SpanAttributes[\'http.url\']"). ' +
              'Multiple expressions, function calls, or sub-queries are not allowed.',
          },
        ],
      };
    }
    bodyColumn = parts[0];
  } else {
    bodyColumn = resolveBodyExpression(source);
  }
  if (!bodyColumn) {
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text:
            'Could not determine body column for pattern mining. ' +
            'This source may not have a body/spanName expression configured. ' +
            'Try specifying bodyExpression explicitly.',
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

  const tsExpr = getFirstTimestampValueExpression(
    source.timestampValueExpression,
  );
  const implicitColumn =
    'implicitColumnExpression' in source
      ? source.implicitColumnExpression
      : undefined;
  const useTextIndexForImplicitColumn =
    'useTextIndexForImplicitColumn' in source
      ? source.useTextIndexForImplicitColumn
      : undefined;

  // ── Query 1: Random sample of events ──
  const sampleConfig = {
    displayType: DisplayType.Search,
    source: source._id.toString(),
    select: `${bodyColumn} as __hdx_pattern_body, ${tsExpr} as __hdx_pattern_ts`,
    from: {
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
    },
    where: options?.where ?? '',
    whereLanguage: options?.whereLanguage ?? ('lucene' as const),
    connection: source.connection.toString(),
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: implicitColumn,
    useTextIndexForImplicitColumn,
    orderBy: [{ ordering: 'DESC' as const, valueExpression: 'rand()' }],
    limit: { limit: sampleSize, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  // ── Query 2: Total count ──
  const countConfig = {
    displayType: DisplayType.Table,
    source: source._id.toString(),
    select: 'count() as total',
    from: {
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
    },
    where: options?.where ?? '',
    whereLanguage: options?.whereLanguage ?? ('lucene' as const),
    connection: source.connection.toString(),
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: implicitColumn,
    useTextIndexForImplicitColumn,
    limit: { limit: 1, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  // Fire both queries in parallel
  let sampleResult: Awaited<
    ReturnType<typeof clickhouseClient.queryChartConfig>
  >;
  let countResult: Awaited<
    ReturnType<typeof clickhouseClient.queryChartConfig>
  >;
  try {
    [sampleResult, countResult] = await Promise.all([
      clickhouseClient.queryChartConfig({
        config: sampleConfig,
        metadata,
        querySettings: source.querySettings,
        opts: { clickhouse_settings: { max_execution_time: 30 } },
      }),
      clickhouseClient.queryChartConfig({
        config: countConfig,
        metadata,
        querySettings: source.querySettings,
        opts: { clickhouse_settings: { max_execution_time: 30 } },
      }),
    ]);
  } catch (err) {
    return clickHouseErrorResult(err);
  }

  const sampleRows = sampleResult.data;
  const totalCount = Number(countResult.data?.[0]?.total ?? 0);

  if (!sampleRows || sampleRows.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              summary: {
                totalCount,
                sampledCount: 0,
                sampleMultiplier: 1,
                clusterCount: 0,
                patternsReturned: 0,
                bodyColumn,
                timeRange: {
                  start: startDate.toISOString(),
                  end: endDate.toISOString(),
                },
              },
              patterns: [],
              hint: 'No data found in the queried time range. Try setting startTime to a wider window (e.g. 24 hours ago) or check that filters match existing data.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // ── Mine patterns using the shared Drain pipeline ──
  let rawPatterns: ReturnType<typeof minePatterns>['patterns'];
  let sampleMultiplier: number;
  try {
    ({ patterns: rawPatterns, sampleMultiplier } = minePatterns(sampleRows, {
      totalCount,
      startDate,
      endDate,
      trendBuckets,
      maxSamples: 5,
      getBody: row => {
        const raw = row.__hdx_pattern_body;
        return raw != null ? String(raw) : '';
      },
      getTimestamp: row => {
        const tsRaw = row.__hdx_pattern_ts;
        return tsRaw != null ? new Date(String(tsRaw)).getTime() : null;
      },
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: `Pattern mining failed: ${message}`,
        },
      ],
    };
  }

  // ── Format response ──
  // Convert trend timestamps to ISO strings, extract sample body texts,
  // and build a whereSnippet per pattern so the agent can drill into
  // matching events via a follow-up hyperdx_search query.
  const sampledCount = sampleRows.length;
  const slicedPatterns = rawPatterns.slice(0, topN);

  const patterns = slicedPatterns.map((p, i) => {
    // Build a Lucene-compatible where clause from the pattern's literal
    // (non-<*>) tokens. This lets agents chain: pattern → search.
    // Escape \ and " (the phrase-query metachars) in each token.
    const literalTokens = p.pattern
      .split(/\s+/)
      .filter(t => t !== '<*>' && t.length > 0)
      .map(t => t.replace(/[\\"]/g, '\\$&'));
    const whereSnippet =
      literalTokens.length > 0
        ? `${bodyColumn}:"${literalTokens.join(' ')}"`
        : '';

    const shareOfTotal = sampledCount > 0 ? p.sampleCount / sampledCount : 0;

    const formattedTrend =
      trendBuckets > 0
        ? p.trend.map(t => ({
            ts: new Date(t.ts).toISOString(),
            count: t.count,
          }))
        : undefined;

    return {
      rank: i + 1,
      id: p.id,
      pattern: p.pattern,
      estimatedCount: p.estimatedCount,
      sampleCount: p.sampleCount,
      shareOfTotal: Math.round(shareOfTotal * 10000) / 10000,
      whereSnippet,
      ...(formattedTrend ? { trend: formattedTrend } : {}),
      samples: p.samples.map(row => {
        const raw = row.__hdx_pattern_body;
        return raw != null ? String(raw) : '';
      }),
    };
  });

  const output = {
    summary: {
      totalCount,
      sampledCount,
      sampleMultiplier: Math.round(sampleMultiplier * 100) / 100,
      clusterCount: rawPatterns.length,
      patternsReturned: patterns.length,
      bodyColumn,
      timeRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    },
    patterns,
    usage:
      'shareOfTotal is the fraction of sampled rows matching this pattern. ' +
      'estimatedCount = sampleCount * sampleMultiplier. ' +
      (trendBuckets > 0
        ? 'trend.count is similarly extrapolated from sample bucket counts. '
        : '') +
      'Use whereSnippet as the "where" parameter in a hyperdx_search call to browse matching raw events.',
  };

  const { data: trimmedOutput, isTrimmed } = trimToolResponse(output);

  const finalOutput = isTrimmed
    ? {
        ...trimmedOutput,
        note: 'Result was trimmed for context size. Narrow the time range, add filters, or reduce topN to reduce data.',
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
}
