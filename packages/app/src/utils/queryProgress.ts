import type { ClickHouseProgress } from '@hyperdx/common-utils/dist/clickhouse';

/**
 * `total_rows_to_read` is an estimate, and a query with a LIMIT over a sorted
 * table routinely terminates early — so read_rows can reach or exceed it while
 * rows are still on the way. Cap the reported percentage short of full so a
 * still-running query never looks finished.
 */
export const MAX_DISPLAYED_PERCENT = 99;

/** Progress for one time window of a chunked/windowed query. */
export type ChunkProgress = {
  /** Duration of the window this chunk covers, in ms. */
  rangeMs: number;
  readRows: number;
  readBytes: number;
  /**
   * How far through its own window this chunk is, 0..1. Undefined when
   * ClickHouse has not yet reported a `total_rows_to_read` estimate.
   */
  fraction: number | undefined;
  isComplete: boolean;
};

export type QueryProgressSummary = {
  /**
   * Share of the whole requested date range searched so far, 0..100. Undefined
   * when nothing measurable has arrived yet — render an indeterminate bar.
   */
  percent: number | undefined;
  readRows: number;
  readBytes: number;
  elapsedMs: number;
};

function toCount(value: string | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How far through its own scan a single ClickHouse query is, 0..1, or
 * undefined when the server has not estimated `total_rows_to_read` yet.
 */
export function progressFraction(
  progress: ClickHouseProgress,
): number | undefined {
  const total = toCount(progress.total_rows_to_read);
  if (total <= 0) return undefined;
  return Math.min(toCount(progress.read_rows) / total, 1);
}

/** Builds a chunk entry from a raw ClickHouse progress event. */
export function toChunkProgress(
  progress: ClickHouseProgress,
  rangeMs: number,
): ChunkProgress {
  return {
    rangeMs,
    readRows: toCount(progress.read_rows),
    readBytes: toCount(progress.read_bytes),
    fraction: progressFraction(progress),
    isComplete: false,
  };
}

/**
 * Combines per-window progress into one whole-query summary.
 *
 * The percentage is *time coverage*, not rows: each window contributes its own
 * share of the total date range, weighted by how far into it the server has
 * scanned. Rows are a poor basis here because the only available denominator
 * (an EXPLAIN estimate) ignores skip indexes and early LIMIT termination, and
 * goes badly wrong when a chart is rewritten onto a materialized view — so a
 * row-based bar would routinely stall well short of the end. Time coverage
 * also matches what the surrounding UI already says ("Searched <date>…
 * across about 1 month").
 *
 * `completedRangeMs` covers windows already fully searched whose per-chunk
 * entries are gone (e.g. pages restored from cache).
 */
export function summarizeChunkProgress({
  chunks,
  totalRangeMs,
  completedRangeMs = 0,
  completedRows = 0,
  completedBytes = 0,
  elapsedMs,
}: {
  chunks: ChunkProgress[];
  totalRangeMs: number;
  completedRangeMs?: number;
  completedRows?: number;
  completedBytes?: number;
  elapsedMs: number;
}): QueryProgressSummary {
  let coveredMs = completedRangeMs;
  let readRows = completedRows;
  let readBytes = completedBytes;
  let hasMeasurableCoverage = completedRangeMs > 0;

  for (const chunk of chunks) {
    readRows += chunk.readRows;
    readBytes += chunk.readBytes;

    if (chunk.isComplete) {
      coveredMs += chunk.rangeMs;
      hasMeasurableCoverage = true;
    } else if (chunk.fraction != null) {
      coveredMs += chunk.rangeMs * chunk.fraction;
      hasMeasurableCoverage = true;
    }
  }

  const percent =
    hasMeasurableCoverage && totalRangeMs > 0
      ? Math.min((coveredMs / totalRangeMs) * 100, MAX_DISPLAYED_PERCENT)
      : undefined;

  return { percent, readRows, readBytes, elapsedMs };
}
