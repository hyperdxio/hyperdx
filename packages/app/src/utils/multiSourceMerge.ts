/**
 * Pure merge logic for multi-source search: k-way merges per-source result
 * streams by timestamp, bounded by a "safe frontier" so the interleaved
 * timeline never shows a gap another source could still fill.
 *
 * Every source stream paginates through the same progressive time windows
 * (see utils/searchWindows.ts — windows are a pure function of the date
 * range), but streams advance at different speeds: one source may be three
 * windows deep while another is still mid-window at its row LIMIT. A merged
 * DESC timeline is only correct down to the timestamp every stream has
 * covered; rows older than that are held back until the lagging streams catch
 * up.
 */

/** Client-side fields tagged onto every merged row. Never sent to ClickHouse. */
export const MULTI_SOURCE_ROW_FIELDS = {
  SOURCE_ID: '__hdx_source_id',
  SOURCE_NAME: '__hdx_source_name',
  SOURCE_COLOR: '__hdx_source_color',
} as const;

export type MergeDirection = 'ASC' | 'DESC';

export type StreamSnapshot = {
  sourceId: string;
  sourceName: string;
  /** Badge/series color for this source; tagged onto rows for the table cell. */
  sourceColor?: string;
  /**
   * Rows fetched so far, in stream order (newest-first for DESC,
   * oldest-first for ASC) — the order the windowed query produces.
   */
  rows: Record<string, any>[];
  /** The last fetched page's time window; null when no page has completed. */
  window: { startTime: Date; endTime: Date } | null;
  /**
   * Row count of the last fetched page; 0 means the window was drained,
   * >0 means the stream may have stopped mid-window at its LIMIT.
   * Null when no page has completed.
   */
  lastPageRowCount: number | null;
  hasNextPage: boolean;
  /**
   * Errored/excluded streams don't bound the frontier (they'd stall the merge
   * forever); their already-fetched rows are still shown.
   */
  isActive: boolean;
  /** The full searched range, used when a stream is fully drained. */
  dateRange: [Date, Date];
};

/**
 * Epoch-ms timestamp T such that this stream is guaranteed to have produced
 * every row it has on the already-covered side of T:
 *   DESC — all of the stream's rows with ts >= T are fetched;
 *   ASC  — all of the stream's rows with ts <= T are fetched.
 *
 * Conservative by construction: when the stream stopped mid-window at its
 * LIMIT, coverage only extends to the last row it returned, not the window
 * boundary.
 */
export function coveredUntil(
  stream: StreamSnapshot,
  direction: MergeDirection,
  parseTs: (row: Record<string, any>) => number,
): number {
  const [start, end] = stream.dateRange;

  if (stream.window == null || stream.lastPageRowCount == null) {
    // Nothing fetched yet: no coverage at all. Checked before hasNextPage —
    // useInfiniteQuery reports hasNextPage=false during the initial fetch,
    // which must not read as "fully drained".
    return direction === 'DESC' ? end.getTime() : start.getTime();
  }

  if (!stream.hasNextPage) {
    // Fully drained: the stream covered the entire searched range.
    return direction === 'DESC' ? start.getTime() : end.getTime();
  }

  if (stream.lastPageRowCount === 0) {
    // The last window came back empty, so it is fully covered.
    return direction === 'DESC'
      ? stream.window.startTime.getTime()
      : stream.window.endTime.getTime();
  }

  // Mid-window at LIMIT: covered only through the last row returned. Rows are
  // in stream order, so the last row is the furthest-along one.
  const lastRow = stream.rows[stream.rows.length - 1];
  if (lastRow == null) {
    // Defensive: a non-zero lastPageRowCount implies rows exist.
    return direction === 'DESC'
      ? stream.window.endTime.getTime()
      : stream.window.startTime.getTime();
  }
  return parseTs(lastRow);
}

/**
 * The merge frontier: the timestamp every active stream has covered.
 * DESC — rows with ts >= frontier are safe to show; ASC — ts <= frontier.
 * Null when there are no active streams (nothing bounds the merge).
 */
export function computeFrontier(
  streams: StreamSnapshot[],
  direction: MergeDirection,
  parseTs: (row: Record<string, any>) => number,
): number | null {
  let frontier: number | null = null;
  for (const stream of streams) {
    if (!stream.isActive) continue;
    const covered = coveredUntil(stream, direction, parseTs);
    if (frontier == null) {
      frontier = covered;
    } else {
      frontier =
        direction === 'DESC'
          ? Math.max(frontier, covered)
          : Math.min(frontier, covered);
    }
  }
  return frontier;
}

/**
 * The active streams holding the frontier back that can be advanced with
 * another page fetch. Streams whose initial fetch hasn't completed are not
 * included — their in-flight request IS their advancement.
 */
function laggingStreams(
  streams: StreamSnapshot[],
  direction: MergeDirection,
  parseTs: (row: Record<string, any>) => number,
): StreamSnapshot[] {
  const frontier = computeFrontier(streams, direction, parseTs);
  if (frontier == null) return [];
  return streams.filter(
    stream =>
      stream.isActive &&
      stream.hasNextPage &&
      stream.window != null &&
      coveredUntil(stream, direction, parseTs) === frontier,
  );
}

export type MergedRow = Record<string, any>;

/**
 * Merge all fetched rows across streams into one timestamp-ordered list,
 * tagged with their origin source, held back at the frontier.
 *
 * Rows from inactive (errored/excluded) streams are still included — they are
 * valid data — but only active streams bound the frontier, so a dead source
 * can't freeze the timeline.
 */
function mergeStreamRows(
  streams: StreamSnapshot[],
  direction: MergeDirection,
  timestampKey: string,
): MergedRow[] {
  // Timestamps repeat heavily at second precision; cache the Date parse per
  // distinct raw value (same trick as ChartUtils' time-chart transform).
  const tsCache = new Map<unknown, number>();
  const parseTs = (row: Record<string, any>): number => {
    const raw = row[timestampKey];
    let ts = tsCache.get(raw);
    if (ts === undefined) {
      ts = new Date(raw).getTime();
      tsCache.set(raw, ts);
    }
    return ts;
  };

  const frontier = computeFrontier(streams, direction, parseTs);

  const tagged: { row: MergedRow; ts: number }[] = [];
  for (const stream of streams) {
    for (const row of stream.rows) {
      const ts = parseTs(row);
      if (
        frontier != null &&
        (direction === 'DESC' ? ts < frontier : ts > frontier)
      ) {
        continue;
      }
      tagged.push({
        row: {
          ...row,
          [MULTI_SOURCE_ROW_FIELDS.SOURCE_ID]: stream.sourceId,
          [MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME]: stream.sourceName,
          ...(stream.sourceColor != null
            ? { [MULTI_SOURCE_ROW_FIELDS.SOURCE_COLOR]: stream.sourceColor }
            : {}),
        },
        ts,
      });
    }
  }

  // Array.prototype.sort is stable, so ties keep (stream order, row order).
  tagged.sort((a, b) => (direction === 'DESC' ? b.ts - a.ts : a.ts - b.ts));

  return tagged.map(t => t.row);
}

/**
 * Convenience wrapper used by the table component: one pass producing the
 * merged rows, the frontier (for the "loading up to" indicator), and which
 * streams to advance on the next fetch.
 */
export function mergeStreams(
  streams: StreamSnapshot[],
  direction: MergeDirection,
  timestampKey: string,
): {
  rows: MergedRow[];
  frontier: number | null;
  laggingSourceIds: string[];
} {
  const tsCache = new Map<unknown, number>();
  const parseTs = (row: Record<string, any>): number => {
    const raw = row[timestampKey];
    let ts = tsCache.get(raw);
    if (ts === undefined) {
      ts = new Date(raw).getTime();
      tsCache.set(raw, ts);
    }
    return ts;
  };

  return {
    rows: mergeStreamRows(streams, direction, timestampKey),
    frontier: computeFrontier(streams, direction, parseTs),
    laggingSourceIds: laggingStreams(streams, direction, parseTs).map(
      s => s.sourceId,
    ),
  };
}
