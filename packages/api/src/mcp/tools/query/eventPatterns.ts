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
  },
) {
  const sampleSize = options?.sampleSize ?? 10_000;

  // ── Resolve source & connection ──
  const source = await getSource(teamId, sourceId);
  if (!source) {
    return {
      isError: true as const,
      content: [
        { type: 'text' as const, text: `Source not found: ${sourceId}` },
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
          text: `Connection not found for source: ${sourceId}`,
        },
      ],
    };
  }

  // ── Determine body column ──
  // Sanitize caller-supplied bodyExpression: must be a single column reference
  // matching the documented format (e.g. "Body", "SpanAttributes['http.url']").
  // The allowlist rejects injection attempts like "Body) OR (1=1".
  const BODY_EXPR_PATTERN = /^[A-Za-z_][\w.]*(\['.+?'\])?$/;
  let bodyColumn: string | undefined;
  if (options?.bodyExpression) {
    const parts = splitAndTrimWithBracket(options.bodyExpression);
    if (parts.length !== 1 || !BODY_EXPR_PATTERN.test(parts[0])) {
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
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: `ClickHouse query failed: ${message}`,
        },
      ],
    };
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
              result: {
                patterns: [],
                totalCount,
                sampledRows: 0,
                sampleMultiplier: 1,
                bodyColumn,
                timeRange: {
                  start: startDate.toISOString(),
                  end: endDate.toISOString(),
                },
              },
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
  // matching events via a follow-up displayType:"search" query.
  const patterns = rawPatterns.map(p => {
    // Build a Lucene-compatible where clause from the pattern's literal
    // (non-<*>) tokens. This lets agents chain: pattern → search.
    // Escape Lucene special chars so tokens like `"hello"` don't break the query.
    const literalTokens = p.pattern
      .split(/\s+/)
      .filter(t => t !== '<*>' && t.length > 0)
      .map(t => t.replace(/[\\+"]/g, '\\$&'));
    const whereSnippet =
      literalTokens.length > 0
        ? `${bodyColumn}:"${literalTokens.join(' ')}"`
        : '';

    return {
      id: p.id,
      pattern: p.pattern,
      estimatedCount: p.estimatedCount,
      sampleCount: p.sampleCount,
      whereSnippet,
      trend: p.trend.map(t => ({
        ts: new Date(t.ts).toISOString(),
        count: t.count,
      })),
      samples: p.samples.map(row => {
        const raw = row.__hdx_pattern_body;
        return raw != null ? String(raw) : '';
      }),
    };
  });

  const output = {
    patterns,
    totalCount,
    sampledRows: sampleRows.length,
    sampleMultiplier: Math.round(sampleMultiplier * 100) / 100,
    bodyColumn,
    timeRange: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  };

  const trimmedOutput = trimToolResponse(output);
  const isTrimmed =
    JSON.stringify(trimmedOutput).length < JSON.stringify(output).length;

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            result: trimmedOutput,
            ...(isTrimmed
              ? {
                  note: 'Result was trimmed for context size. Narrow the time range or add filters to reduce data.',
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
