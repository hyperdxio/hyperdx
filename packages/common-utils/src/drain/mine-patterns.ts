import { convertDateRangeToGranularityString } from '../core/utils';
import { TemplateMinerConfig } from './config';
import { TemplateMiner } from './template-miner';

// ─── Time bucketing utilities ────────────────────────────────────────────────

/** Parse a granularity string like "5 minute" into milliseconds. */
function granularityToMs(granularity: string): number {
  const [num, unit] = granularity.split(' ');
  const n = parseInt(num, 10);
  switch (unit) {
    case 'second':
      return n * 1_000;
    case 'minute':
      return n * 60_000;
    case 'hour':
      return n * 3_600_000;
    case 'day':
      return n * 86_400_000;
    default:
      return n * 60_000;
  }
}

/** Round a timestamp down to the start of its granularity bucket. */
function toStartOfBucket(tsMs: number, granularityMs: number): number {
  return Math.floor(tsMs / granularityMs) * granularityMs;
}

/** Generate all bucket start timestamps between start and end. */
function generateBuckets(
  startMs: number,
  endMs: number,
  granularityMs: number,
): number[] {
  const buckets: number[] = [];
  let current = toStartOfBucket(startMs, granularityMs);
  while (current < endMs) {
    buckets.push(current);
    current += granularityMs;
  }
  return buckets;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrendBucket {
  /** Bucket start timestamp in milliseconds. */
  ts: number;
  /** Estimated count for this bucket (scaled by sampleMultiplier). */
  count: number;
}

export interface PatternGroup<TRow = Record<string, unknown>> {
  /** Cluster ID from the Drain algorithm. */
  id: string;
  /** Generalized template string with <*> placeholders. */
  pattern: string;
  /** Raw count of matching rows within the sample. */
  sampleCount: number;
  /** Estimated total count (sampleCount * sampleMultiplier). */
  estimatedCount: number;
  /** Sample rows that matched this pattern (capped by maxSamples). */
  samples: TRow[];
  /** Time-bucketed trend data. */
  trend: TrendBucket[];
}

export interface MinePatternResult<TRow = Record<string, unknown>> {
  patterns: PatternGroup<TRow>[];
  sampleMultiplier: number;
}

export interface MinePatternOptions {
  /** Total event count for the full (unsampled) time range. Used to compute sampleMultiplier. */
  totalCount: number;
  /** Start of the query time range. */
  startDate: Date;
  /** End of the query time range. */
  endDate: Date;
  /** Max number of trend time buckets to generate. Default: 24. */
  trendBuckets?: number;
  /** Max number of sample rows to keep per pattern. Default: 5. */
  maxSamples?: number;
  /**
   * Extract the body text from a row. The returned string is what gets
   * fed into the Drain algorithm.
   */
  getBody: (row: Record<string, unknown>) => string;
  /**
   * Extract the timestamp (as epoch ms) from a row.
   * Falls back to startDate if the extractor returns null/undefined.
   */
  getTimestamp: (row: Record<string, unknown>) => number | null | undefined;
}

// ─── Core mining function ────────────────────────────────────────────────────

/**
 * Run the Drain log-template mining algorithm over a set of sampled rows.
 *
 * This is a pure function: it takes already-fetched rows, mines patterns,
 * groups them, computes estimated counts and trend data, and returns sorted
 * pattern groups. Both the MCP server and the CLI use this to avoid duplicating
 * the Drain + bucketing + grouping logic.
 */
export function minePatterns<TRow extends Record<string, unknown>>(
  rows: TRow[],
  options: MinePatternOptions,
): MinePatternResult<TRow> {
  const {
    totalCount,
    startDate,
    endDate,
    trendBuckets = 24,
    maxSamples = 5,
    getBody,
    getTimestamp,
  } = options;

  if (rows.length === 0) {
    return { patterns: [], sampleMultiplier: 1 };
  }

  // ── Set up Drain miner ──
  const drainConfig = new TemplateMinerConfig();
  const miner = new TemplateMiner(drainConfig);

  // ── Compute time buckets ──
  const granularity = convertDateRangeToGranularityString(
    [startDate, endDate],
    trendBuckets,
  );
  const granularityMs = granularityToMs(granularity);
  const allBuckets = generateBuckets(
    startDate.getTime(),
    endDate.getTime(),
    granularityMs,
  );

  // ── Process each row through Drain ──
  const clustered: Array<{
    clusterId: number;
    row: TRow;
    tsMs: number;
  }> = [];
  for (const row of rows) {
    const bodyText = getBody(row);
    const result = miner.addLogMessage(bodyText);
    const tsMs = getTimestamp(row) ?? startDate.getTime();
    clustered.push({ clusterId: result.clusterId, row, tsMs });
  }

  // ── Group by cluster ID ──
  const groups = new Map<
    number,
    {
      samples: TRow[];
      template: string;
      bucketCounts: Map<number, number>;
    }
  >();

  for (const { clusterId, row, tsMs } of clustered) {
    const bucket = toStartOfBucket(tsMs, granularityMs);
    const existing = groups.get(clusterId);
    if (existing) {
      if (existing.samples.length < maxSamples) {
        existing.samples.push(row);
      }
      existing.bucketCounts.set(
        bucket,
        (existing.bucketCounts.get(bucket) ?? 0) + 1,
      );
    } else {
      const bodyText = getBody(row);
      const match = miner.match(bodyText, 'fallback');
      const bucketCounts = new Map<number, number>();
      bucketCounts.set(bucket, 1);
      groups.set(clusterId, {
        samples: [row],
        template: match?.getTemplate() ?? bodyText,
        bucketCounts,
      });
    }
  }

  // ── Build result with estimated counts ──
  const sampleMultiplier =
    totalCount > 0 && rows.length > 0 ? totalCount / rows.length : 1;

  // Pre-compute per-cluster counts
  const clusterCounts = new Map<number, number>();
  for (const { clusterId } of clustered) {
    clusterCounts.set(clusterId, (clusterCounts.get(clusterId) ?? 0) + 1);
  }

  const patterns: PatternGroup<TRow>[] = [];
  for (const [id, { samples, template, bucketCounts }] of groups) {
    const sampleCount = clusterCounts.get(id) ?? 0;

    const trend: TrendBucket[] = allBuckets.map(bucketTs => ({
      ts: bucketTs,
      count: Math.round((bucketCounts.get(bucketTs) ?? 0) * sampleMultiplier),
    }));

    patterns.push({
      id: String(id),
      pattern: template,
      sampleCount,
      estimatedCount: Math.max(Math.round(sampleCount * sampleMultiplier), 1),
      samples,
      trend,
    });
  }

  patterns.sort((a, b) => b.estimatedCount - a.estimatedCount);

  return { patterns, sampleMultiplier };
}
