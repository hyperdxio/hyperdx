import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  convertGranularityToSeconds,
  getFirstTimestampValueExpression,
  type Granularity,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import { minePatterns } from '@hyperdx/common-utils/dist/drain';
import type {
  ChartConfigWithDateRange,
  ChartVariable,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { trace } from '@opentelemetry/api';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  type McpErrorResult,
  mcpServerError,
  mcpUserError,
} from '@/mcp/utils/errors';
import { MCP_QUERY_MAX_EXECUTION_SEC } from '@/mcp/utils/timeout';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';

import {
  clickHouseErrorResult,
  normalizeBodyExpression,
  resolveBodyExpression,
} from './helpers';
import {
  andSql,
  buildPatternPredicate,
  MAX_PREDICATE_TEMPLATE_LENGTH,
  PATTERN_MATCH_SEMANTICS,
  userWhereAsSql,
} from './patternDrilldown';

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
    abortSignal?: AbortSignal;
    /** Dashboard variables and their selected values. Omitted outside a dashboard context. */
    variables?: ChartVariable[];
    /** Also render every row filter as one SQL condition for drill-down. */
    includeDrilldownWhere?: boolean;
  },
): Promise<
  | { error: McpErrorResult }
  | {
      patterns: ReturnType<typeof minePatterns>['patterns'];
      sampleMultiplier: number;
      totalCount: number;
      sampledCount: number;
      bodyColumn: string;
      trendGranularity?: Granularity;
      trendBucketStarts: number[];
      /**
       * Row filters as one SQL condition ('' when there are none). Undefined
       * when not requested. The source table filter is always included; the
       * caller filter only when `includesUserFilter` is true (it could not be
       * rendered as SQL otherwise).
       */
      drilldown?: { where: string; includesUserFilter: boolean };
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

  // Sanitize caller-supplied bodyExpression: a single column/map reference or
  // JSONExtractString over one. The allowlist rejects injection attempts like
  // "Body) OR (1=1".
  let bodyColumn: string | undefined;
  if (options?.bodyExpression) {
    const parts = splitAndTrimWithBracket(options.bodyExpression);
    const normalized =
      parts.length === 1 ? normalizeBodyExpression(parts[0]) : null;
    if (normalized == null) {
      return {
        error: mcpUserError(
          'bodyExpression must be a single column or map reference ' +
            '(e.g. "Body", "SpanName", "SpanAttributes[\'http.url\']"), or ' +
            'JSONExtractString over one with string-literal keys ' +
            "(e.g. \"JSONExtractString(Body, 'error', 'message')\"). " +
            'Other function calls, multiple expressions, or sub-queries are not allowed.',
        ),
      };
    }
    bodyColumn = normalized;
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

  const tableFilterSql =
    source.kind === SourceKind.Log &&
    'tableFilterExpression' in source &&
    source.tableFilterExpression
      ? source.tableFilterExpression
      : undefined;
  const filters = tableFilterSql
    ? [{ type: 'sql' as const, condition: tableFilterSql }]
    : [];

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

  // `variables` rides on both configs so the renderer expands variable
  // references and macros in `where` the same way it does for every other
  // dashboard tile. Undefined (the standalone-tool case) is a no-op there.
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
    filters,
    connection: source.connection.toString(),
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: implicitColumn,
    useTextIndexForImplicitColumn,
    orderBy: [{ ordering: 'DESC' as const, valueExpression: 'rand()' }],
    limit: { limit: sampleSize, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
    variables: options?.variables,
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
    filters,
    connection: source.connection.toString(),
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: implicitColumn,
    useTextIndexForImplicitColumn,
    limit: { limit: 1, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
    variables: options?.variables,
  } satisfies ChartConfigWithDateRange;

  // Drill-down is optional, so a caller filter that cannot be rendered as SQL
  // resolves to null instead of failing the mining.
  const userWherePromise: Promise<string | null | undefined> =
    options?.includeDrilldownWhere
      ? userWhereAsSql({
          where: options.where ?? '',
          whereLanguage: options.whereLanguage ?? 'lucene',
          variables: options.variables,
          metadata,
          databaseName: source.from.databaseName,
          tableName: source.from.tableName,
          connectionId: source.connection.toString(),
          implicitColumnExpression: implicitColumn,
          useTextIndexForImplicitColumn,
        }).catch(err => {
          trace.getActiveSpan()?.setAttributes({
            'mcp.event_patterns.drilldown_where_failed': true,
            'mcp.event_patterns.drilldown_where_error':
              err instanceof Error ? err.message : String(err),
          });
          logger.warn(
            { err, teamId, sourceId },
            'event patterns: could not render where as SQL for drill-down',
          );
          return null;
        })
      : Promise.resolve(undefined);

  // The client is constructed fresh per call (not pooled) and serves the two
  // queries below plus the metadata lookups of the drill-down rendering — the
  // Drain mining afterward never touches it. Close it in a finally so the
  // underlying HTTP agent's sockets are released whether the queries succeed
  // or throw, rather than leaking one client per call (emerging_signals opens
  // two per invocation).
  let sampleResult, countResult;
  let userWhereSql: string | null | undefined;
  try {
    [sampleResult, countResult, userWhereSql] = await Promise.all([
      clickhouseClient.queryChartConfig({
        config: sampleConfig,
        metadata,
        querySettings: source.querySettings,
        opts: {
          clickhouse_settings: {
            max_execution_time: MCP_QUERY_MAX_EXECUTION_SEC,
          },
          abort_signal: options?.abortSignal,
        },
      }),
      clickhouseClient.queryChartConfig({
        config: countConfig,
        metadata,
        querySettings: source.querySettings,
        opts: {
          clickhouse_settings: {
            max_execution_time: MCP_QUERY_MAX_EXECUTION_SEC,
          },
          abort_signal: options?.abortSignal,
        },
      }),
      userWherePromise,
    ]);
  } catch (err) {
    return { error: clickHouseErrorResult(err) };
  } finally {
    await clickhouseClient.close().catch(() => {});
  }

  const sampleRows = sampleResult.data ?? [];
  const totalCount = Number(countResult.data?.[0]?.total ?? 0);
  const drilldown =
    userWhereSql === undefined
      ? undefined
      : {
          where: andSql(tableFilterSql, userWhereSql ?? undefined),
          includesUserFilter: userWhereSql !== null,
        };

  // Wrap the synchronous Drain mining in try/catch. Without this a thrown
  // Drain error escapes the helper — and since callers (emerging_signals)
  // await it inside Promise.all and only inspect the returned {error} union
  // AFTER the await, an unwrapped throw becomes an unhandled rejection / 500
  // instead of a clean MCP error result.
  let mined: ReturnType<typeof minePatterns>;
  try {
    mined = minePatterns(sampleRows, {
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: mcpServerError(`Pattern mining failed: ${message}`) };
  }

  return {
    totalCount,
    bodyColumn,
    drilldown,
    patterns: mined.patterns,
    sampleMultiplier: mined.sampleMultiplier,
    sampledCount: sampleRows.length,
    trendGranularity: mined.trendGranularity,
    trendBucketStarts: mined.trendBucketStarts,
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
    abortSignal?: AbortSignal;
    /** Dashboard variables and their selected values. Omitted outside a dashboard context. */
    variables?: ChartVariable[];
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
    abortSignal: options?.abortSignal,
    variables: options?.variables,
    includeDrilldownWhere: true,
  });
  if ('error' in mined) return mined.error;

  const {
    patterns: rawPatterns,
    sampleMultiplier,
    totalCount,
    sampledCount,
    bodyColumn,
    trendGranularity,
    trendBucketStarts,
    drilldown,
  } = mined;

  const timeRange = {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };

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
                timeRange,
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
  const slicedPatterns = rawPatterns.slice(0, topN);

  const patterns = slicedPatterns.map((p, i) => {
    const predicate = buildPatternPredicate(bodyColumn, p.pattern);
    const whereSnippet =
      predicate == null ? '' : andSql(drilldown?.where, predicate);

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
      whereLanguage: 'sql' as const,
      ...(predicate == null
        ? {
            drilldownUnavailable:
              `Template is longer than ${MAX_PREDICATE_TEMPLATE_LENGTH} characters, so ` +
              'whereSnippet is empty. Do not search with it; it would match every row.',
          }
        : {}),
      ...(formattedTrend ? { trend: formattedTrend } : {}),
      samples: p.samples.map(row => {
        const raw = row.__hdx_pattern_body;
        return raw != null ? String(raw) : '';
      }),
    };
  });

  const trendSummary =
    trendGranularity && trendBucketStarts.length > 0
      ? {
          requestedBuckets: trendBuckets,
          bucketCount: trendBucketStarts.length,
          bucketInterval: trendGranularity,
          firstBucketStart: new Date(trendBucketStarts[0]).toISOString(),
          lastBucketEnd: new Date(
            trendBucketStarts[trendBucketStarts.length - 1] +
              convertGranularityToSeconds(trendGranularity) * 1000,
          ).toISOString(),
        }
      : undefined;

  const output = {
    summary: {
      totalCount,
      sampledCount,
      sampleCoverage:
        totalCount > 0
          ? Math.round(Math.min(sampledCount / totalCount, 1) * 10000) / 10000
          : 1,
      sampleMultiplier: Math.round(sampleMultiplier * 100) / 100,
      clusterCount: rawPatterns.length,
      patternsReturned: patterns.length,
      bodyColumn,
      timeRange,
      ...(trendSummary ? { trend: trendSummary } : {}),
      drilldown: {
        tool: 'clickstack_search',
        sourceId,
        startTime: timeRange.start,
        endTime: timeRange.end,
        whereLanguage: 'sql',
        includesFilters: drilldown?.includesUserFilter ?? false,
        ...(drilldown?.includesUserFilter
          ? {}
          : {
              warning:
                'The where filter could not be rendered as SQL, so whereSnippet holds only ' +
                'the pattern predicate and the source table filter. AND your filter onto it ' +
                '(in SQL) before searching.',
            }),
        matchSemantics: PATTERN_MATCH_SEMANTICS,
      },
    },
    patterns,
    usage:
      'totalCount is exact. sampleCount is the number of sampled rows in the pattern. ' +
      'estimatedCount = sampleCount * sampleMultiplier, an extrapolation, not a count; ' +
      'use clickstack_table for exact counts. shareOfTotal = sampleCount / sampledCount. ' +
      (trendSummary
        ? 'trend.count = round(sampled rows in the bucket * sampleMultiplier). Buckets are ' +
          'summary.trend.bucketInterval wide and aligned to it, so there can be fewer ' +
          'than requested and the first/last can extend past timeRange (partial buckets). ' +
          'A 0 bucket means no SAMPLED row fell in it, not that none occurred: when ' +
          'sampleMultiplier is N, a bucket with fewer than about N real events often ' +
          'shows 0. Compare trends only for patterns with many sampled rows. '
        : '') +
      'To browse raw events of a pattern, call clickstack_search with the sourceId, ' +
      'startTime and endTime from summary.drilldown, where = whereSnippet, and ' +
      'whereLanguage = "sql". whereSnippet already includes the source table filter and, ' +
      'unless summary.drilldown.includesFilters is false, your where filter, so do not ' +
      'add them again. Skip patterns that have drilldownUnavailable.',
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
