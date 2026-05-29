import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import {
  flattenBody,
  minePatterns,
  TemplateMiner,
  TemplateMinerConfig,
} from '@hyperdx/common-utils/dist/drain';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';

import { resolveBodyExpression } from './helpers';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Patterns matching more than this fraction of sampled events are "noisy". */
const NOISE_THRESHOLD = 0.1;

/** Number of random rows to sample for pattern learning. */
const DENOISE_SAMPLE_SIZE = 10_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DenoiseResult {
  /** Filtered rows with noisy patterns removed. */
  rows: Record<string, unknown>[];
  /** Patterns that were identified as noisy and removed. */
  removedPatterns: Array<{
    pattern: string;
    estimatedCount: number;
    sampleCount: number;
  }>;
}

// ─── Core denoising function ─────────────────────────────────────────────────

/**
 * Denoise search results by mining patterns from a random sample, identifying
 * "noisy" patterns (those accounting for >10% of the sample), and filtering
 * them out of the result rows.
 *
 * This mirrors the web app's "Denoise Results" feature
 * (packages/app/src/components/DBRowTable.tsx) but runs server-side using
 * the shared TypeScript Drain implementation.
 */
export async function denoiseSearchResults(
  teamId: string,
  sourceId: string,
  startDate: Date,
  endDate: Date,
  rows: Record<string, unknown>[],
  options?: {
    where?: string;
    whereLanguage?: 'lucene' | 'sql';
  },
): Promise<DenoiseResult> {
  if (rows.length === 0) {
    return { rows, removedPatterns: [] };
  }

  // ── Resolve source & connection ──
  const source = await getSource(teamId, sourceId);
  if (!source) {
    // Can't denoise without source info — return rows unmodified
    return { rows, removedPatterns: [] };
  }

  const bodyColumn = resolveBodyExpression(source);
  if (!bodyColumn) {
    // Source doesn't have a body column — can't mine patterns
    return { rows, removedPatterns: [] };
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return { rows, removedPatterns: [] };
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

  // ── Query: Random sample of events for pattern learning ──
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
    limit: { limit: DENOISE_SAMPLE_SIZE, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  // ── Query: Total count for sample multiplier ──
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
  } catch {
    // If sampling fails, return rows unmodified rather than failing the search
    return { rows, removedPatterns: [] };
  }

  const sampleRows = sampleResult.data;
  const totalCount = Number(countResult.data?.[0]?.total ?? 0);

  if (!sampleRows || sampleRows.length === 0) {
    return { rows, removedPatterns: [] };
  }

  // ── Mine patterns from the sample ──
  const { patterns, sampleMultiplier } = minePatterns(sampleRows, {
    totalCount,
    startDate,
    endDate,
    maxSamples: 0, // We don't need samples for denoising
    getBody: row => {
      const raw = row.__hdx_pattern_body;
      return raw != null ? String(raw) : '';
    },
    getTimestamp: row => {
      const tsRaw = row.__hdx_pattern_ts;
      return tsRaw != null ? new Date(String(tsRaw)).getTime() : null;
    },
  });

  if (patterns.length === 0) {
    return { rows, removedPatterns: [] };
  }

  // ── Identify noisy patterns (>10% of sampled events) ──
  const sampledRowCount = sampleRows.length;
  const noisyPatternIds = new Set<string>();
  const removedPatterns: DenoiseResult['removedPatterns'] = [];

  for (const p of patterns) {
    if (p.sampleCount / sampledRowCount > NOISE_THRESHOLD) {
      noisyPatternIds.add(p.id);
      removedPatterns.push({
        pattern: p.pattern,
        estimatedCount: p.estimatedCount,
        sampleCount: p.sampleCount,
      });
    }
  }

  if (noisyPatternIds.size === 0) {
    return { rows, removedPatterns: [] };
  }

  // ── Re-create the same Drain miner and train it on the same sample ──
  // We need a fresh miner to match result rows against the learned patterns.
  // The minePatterns() function doesn't expose the miner, so we rebuild it.
  const drainConfig = new TemplateMinerConfig();
  const miner = new TemplateMiner(drainConfig);
  for (const row of sampleRows) {
    const raw = row.__hdx_pattern_body;
    const bodyText = flattenBody(raw != null ? String(raw) : '');
    miner.addLogMessage(bodyText);
  }

  // ── Match each result row and filter out noisy ones ──
  // The body column in result rows may be named differently from the
  // pattern mining column. We try the exact bodyColumn name first,
  // then fall back to common column names.
  const bodyColumnKey = findBodyColumnKey(rows[0], bodyColumn);
  if (!bodyColumnKey) {
    // Can't find the body column in result rows — return unmodified
    return { rows, removedPatterns: [] };
  }

  const filteredRows = rows.filter(row => {
    const bodyValue = row[bodyColumnKey];
    if (bodyValue == null) return true; // Keep rows with no body
    const bodyText = flattenBody(String(bodyValue));
    const match = miner.match(bodyText, 'fallback');
    if (!match) return true; // No pattern match — keep the row
    return !noisyPatternIds.has(String(match.clusterId));
  });

  return {
    rows: filteredRows,
    removedPatterns,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find the key in a result row that corresponds to the body column expression.
 * ClickHouse may return the column under its expression name or a simplified alias.
 */
function findBodyColumnKey(
  row: Record<string, unknown>,
  bodyColumn: string,
): string | null {
  // Direct match (e.g. "Body", "SpanName")
  if (bodyColumn in row) return bodyColumn;

  // Case-insensitive match
  const lowerBody = bodyColumn.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lowerBody) return key;
  }

  return null;
}
