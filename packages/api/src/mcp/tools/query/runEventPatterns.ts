import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import { minePatterns } from '@hyperdx/common-utils/dist/drain';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  type McpErrorResult,
  mcpServerError,
  mcpUserError,
} from '@/mcp/utils/errors';
import { trimToolResponse } from '@/utils/trimToolResponse';

import {
  clickHouseErrorResult,
  resolveBodyExpression,
  SAFE_BODY_EXPR_CHARS,
} from './helpers';

// ─── Reusable window mining ──────────────────────────────────────────────────

/**
 * Sample + Drain-mine one time window and return the raw pattern groups
 * (template + counts), without MCP response formatting. Shared by
 * runEventPatterns (single window) and emerging_signals (two-window diff).
 *
 * Returns either an error result (MCP shape) or the mined patterns.
 */
export async function mineWindowPatterns(
  teamId: string,
  sourceId: string,
  startDate: Date,
  endDate: Date,
  options?: {
    where?: string;
    whereLanguage?: 'lucene' | 'sql';
    bodyExpression?: string;
    sampleSize?: number;
    trendBuckets?: number;
  },
): Promise<
  | { error: McpErrorResult }
  | {
      patterns: ReturnType<typeof minePatterns>['patterns'];
      sampleMultiplier: number;
      totalCount: number;
      sampledCount: number;
      bodyColumn: string;
    }
> {
  const sampleSize = options?.sampleSize ?? 10_000;
  const trendBuckets = options?.trendBuckets ?? 0;

  const source = await getSource(teamId, sourceId);
  if (!source) {
    return {
      error: mcpUserError(
        `Source not found: ${sourceId}. Call clickstack_list_sources to discover available source IDs.`,
      ),
    };
  }
  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return {
      error: mcpUserError(
        `Connection not found for source: ${sourceId}. Call clickstack_list_sources to discover available source IDs.`,
      ),
    };
  }

  // Sanitize caller-supplied bodyExpression: must be a single column reference
  // matching the documented format (e.g. "Body", "SpanAttributes['http.url']").
  // The allowlist rejects injection attempts like "Body) OR (1=1".
  let bodyColumn: string | undefined;
  if (options?.bodyExpression) {
    const parts = splitAndTrimWithBracket(options.bodyExpression);
    if (parts.length !== 1 || !SAFE_BODY_EXPR_CHARS.test(parts[0])) {
      return {
        error: mcpUserError(
          'bodyExpression must be a single column expression ' +
            '(e.g. "Body", "SpanName", "SpanAttributes[\'http.url\']"). ' +
            'Multiple expressions, function calls, or sub-queries are not allowed.',
        ),
      };
    }
    bodyColumn = parts[0];
  } else {
    bodyColumn = resolveBodyExpression(source);
  }
  if (!bodyColumn) {
    return {
      error: mcpUserError(
        'Could not determine body column for pattern mining. ' +
          'This source may not have a body/spanName expression configured. ' +
          'Try specifying bodyExpression explicitly.',
      ),
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

  // The client is constructed fresh per call (not pooled) and is only used for
  // the two queries below — the Drain mining afterward never touches it. Close
  // it in a finally so the underlying HTTP agent's sockets are released whether
  // the queries succeed or throw, rather than leaking one client per call
  // (emerging_signals opens two per invocation).
  let sampleResult, countResult;
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
    return { error: clickHouseErrorResult(err) };
  } finally {
    await clickhouseClient.close().catch(() => {});
  }

  const sampleRows = sampleResult.data ?? [];
  const totalCount = Number(countResult.data?.[0]?.total ?? 0);
  if (sampleRows.length === 0) {
    return {
      patterns: [],
      sampleMultiplier: 1,
      totalCount,
      sampledCount: 0,
      bodyColumn,
    };
  }

  // Wrap the synchronous Drain mining in try/catch. Without this a thrown
  // Drain error escapes the helper — and since callers (emerging_signals)
  // await it inside Promise.all and only inspect the returned {error} union
  // AFTER the await, an unwrapped throw becomes an unhandled rejection / 500
  // instead of a clean MCP error result.
  let patterns: ReturnType<typeof minePatterns>['patterns'];
  let sampleMultiplier: number;
  try {
    ({ patterns, sampleMultiplier } = minePatterns(sampleRows, {
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
    return { error: mcpServerError(`Pattern mining failed: ${message}`) };
  }

  return {
    patterns,
    sampleMultiplier,
    totalCount,
    sampledCount: sampleRows.length,
    bodyColumn,
  };
}

// ─── Drain template normalization (emerging_signals cross-window keying) ─────

/**
 * Normalize a Drain template so the same logical pattern matches across
 * windows despite Drain assigning different cluster ids each run. We collapse
 * runs of whitespace and treat the placeholder token uniformly. Distinct
 * placeholder PLACEMENTS remain distinct (only the placeholder glyph is
 * unified, its position is preserved), so unrelated templates do not collapse.
 *
 * Pure string logic — used by the emerging_signals MCP tool.
 */
export function normalizeTemplate(pattern: string): string {
  return pattern
    .replace(/<\*>/g, '\u0001') // stable placeholder marker
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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
  const topN = options?.topN ?? 20;
  // runEventPatterns defaults trendBuckets to 24 (single-window view wants a
  // per-pattern trend sparkline); the shared helper defaults to 0. Thread the
  // resolved value through so the delegated mining uses the same default.
  const trendBuckets = options?.trendBuckets ?? 24;

  // Delegate source/connection/body resolution + sample/count querying + Drain
  // mining to the shared helper. runEventPatterns keeps ONLY its richer
  // single-window response formatting (topN slicing, whereSnippet, trend ISO
  // conversion, sampleMultiplier usage). The helper wraps minePatterns in
  // try/catch and returns an {error} union, so a thrown Drain error surfaces as
  // a clean MCP error here rather than escaping.
  const mined = await mineWindowPatterns(teamId, sourceId, startDate, endDate, {
    where: options?.where,
    whereLanguage: options?.whereLanguage,
    bodyExpression: options?.bodyExpression,
    sampleSize: options?.sampleSize,
    trendBuckets,
  });
  if ('error' in mined) return mined.error;

  const {
    patterns: rawPatterns,
    sampleMultiplier,
    totalCount,
    sampledCount,
    bodyColumn,
  } = mined;

  if (sampledCount === 0) {
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

  // ── Format response ──
  // Convert trend timestamps to ISO strings, extract sample body texts,
  // and build a whereSnippet per pattern so the agent can drill into
  // matching events via a follow-up clickstack_search query.
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
      'Use whereSnippet as the "where" parameter in a clickstack_search call to browse matching raw events.',
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
