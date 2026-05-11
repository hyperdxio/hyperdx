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

/**
 * Resolve the body column expression for pattern mining from a source.
 * Mirrors the web app's getEventBody() logic (packages/app/src/source.ts).
 */
function resolveBodyExpression(source: {
  kind: string;
  spanNameExpression?: string;
  bodyExpression?: string;
  implicitColumnExpression?: string;
}): string | undefined {
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
  const bodyColumn =
    options?.bodyExpression ??
    resolveBodyExpression(
      source as Parameters<typeof resolveBodyExpression>[0],
    );
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
  const { patterns: rawPatterns, sampleMultiplier } = minePatterns(sampleRows, {
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
  });

  // ── Format response ──
  // Convert trend timestamps to ISO strings and extract sample body texts
  // for a more readable MCP response.
  const patterns = rawPatterns.map(p => ({
    id: p.id,
    pattern: p.pattern,
    estimatedCount: p.estimatedCount,
    sampleCount: p.sampleCount,
    trend: p.trend.map(t => ({
      ts: new Date(t.ts).toISOString(),
      count: t.count,
    })),
    samples: p.samples.map(row => {
      const raw = row.__hdx_pattern_body;
      return raw != null ? String(raw) : '';
    }),
  }));

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
