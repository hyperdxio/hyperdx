import {
  convertDateRangeToGranularityString,
  timeBucketByGranularity,
  toStartOfInterval,
} from '../core/utils';
import { TemplateMinerConfig } from './config';
import { TemplateMiner } from './template-miner';

// ─── Body normalization ──────────────────────────────────────────────────────

/** Collapse newlines and runs of whitespace into single spaces. */
export function flattenBody(s: string): string {
  return s
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

export interface MinePatternOptions<TRow extends Record<string, unknown>> {
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
   * Extract the body text from a row. The returned string is normalized
   * (newlines collapsed, whitespace trimmed) before being fed to Drain.
   */
  getBody: (row: TRow) => string;
  /**
   * Extract the timestamp (as epoch ms) from a row.
   * Falls back to startDate if the extractor returns null/undefined.
   */
  getTimestamp: (row: TRow) => number | null | undefined;
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
  options: MinePatternOptions<TRow>,
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

  // ── Compute time buckets using shared helpers ──
  const granularity = convertDateRangeToGranularityString(
    [startDate, endDate],
    trendBuckets,
  );
  const allBucketDates = timeBucketByGranularity(
    startDate,
    endDate,
    granularity,
  );
  const allBuckets = allBucketDates.map(d => d.getTime());

  // ── Process each row through Drain ──
  const clustered: Array<{
    clusterId: number;
    row: TRow;
    bodyText: string;
    tsMs: number;
  }> = [];
  for (const row of rows) {
    const bodyText = flattenBody(getBody(row));
    const result = miner.addLogMessage(bodyText);
    const tsMs = getTimestamp(row) ?? startDate.getTime();
    clustered.push({ clusterId: result.clusterId, row, bodyText, tsMs });
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

  for (const { clusterId, row, bodyText, tsMs } of clustered) {
    const bucket = toStartOfInterval(new Date(tsMs), granularity).getTime();
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
