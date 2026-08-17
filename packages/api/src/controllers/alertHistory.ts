import PQueue from '@esm2cjs/p-queue';
import {
  ALERT_EVALUATION_GROUPS_LIMIT,
  ALERT_INTERVAL_TO_MINUTES,
  AlertInterval,
  AlertTransition,
} from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';

import { AlertState, IAlertError } from '@/models/alert';
import AlertHistory, {
  IAlertHistory,
  IAlertHistoryAnalytics,
} from '@/models/alertHistory';

// Re-exported for API-side consumers/tests; the app imports it from
// common-utils to explain the cap in the UI.
export { ALERT_EVALUATION_GROUPS_LIMIT };

// Max parallel per-alert queries to avoid overwhelming the DB connection pool
export const ALERT_HISTORY_QUERY_CONCURRENCY = 20;

/** Alert evaluation interval in milliseconds. */
const intervalToMs = (interval: AlertInterval): number =>
  ALERT_INTERVAL_TO_MINUTES[interval] * 60 * 1000;

type GroupedAlertHistory = {
  _id: Date;
  states: string[];
  counts: number;
  lastValues: IAlertHistory['lastValues'][];
  errors: IAlertError[][];
};

function groupStateToOverallState(states: string[]): AlertState {
  if (states.includes(AlertState.ALERT)) {
    return AlertState.ALERT;
  }

  if (states.includes(AlertState.PENDING)) {
    return AlertState.PENDING;
  }

  // An evaluation window that neither fired nor was pending, but recorded an
  // error (query failure, or a notification failure on an OK window), is
  // surfaced as ERROR.
  if (states.includes(AlertState.ERROR)) {
    return AlertState.ERROR;
  }

  return AlertState.OK;
}

/** Dedupe errors by type+message, keeping the most recent occurrence. */
function dedupeErrors(errors: IAlertError[]): IAlertError[] {
  const map = new Map<string, IAlertError>();
  for (const error of errors) {
    const key = `${error.type}||${error.message}`;
    const existing = map.get(key);
    if (!existing || error.timestamp > existing.timestamp) {
      map.set(key, error);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  );
}

function mapGroupedHistories(
  groupedHistories: GroupedAlertHistory[],
): Omit<IAlertHistory, 'alert'>[] {
  return groupedHistories.map(group => {
    // $push skips documents where the field is missing, but be defensive
    // about nulls in case of engine differences (e.g. DocumentDB).
    const errors = dedupeErrors(
      (group.errors ?? []).flat().filter((e): e is IAlertError => e != null),
    );
    return {
      createdAt: group._id,
      state: groupStateToOverallState(group.states),
      counts: group.counts,
      lastValues: group.lastValues
        .flat()
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
      ...(errors.length > 0 && { errors }),
    };
  });
}

/**
 * Fetch grouped evaluation windows (one entry per createdAt, newest first)
 * for the given alert within the createdAt bounds, capped at `limit` groups.
 */
async function fetchGroupedWindows(
  alertId: ObjectId,
  createdAt: Record<string, Date>,
  limit: number,
): Promise<Omit<IAlertHistory, 'alert'>[]> {
  const groupedHistories = await AlertHistory.aggregate<GroupedAlertHistory>([
    {
      $match: {
        alert: new ObjectId(alertId),
        createdAt,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$createdAt',
        states: {
          $push: '$state',
        },
        counts: {
          $sum: '$counts',
        },
        lastValues: {
          $push: '$lastValues',
        },
        errors: {
          $push: '$errors',
        },
      },
    },
    {
      $sort: {
        _id: -1,
      },
    },
    {
      $limit: limit,
    },
  ]);

  return mapGroupedHistories(groupedHistories);
}

/**
 * Gets the most recent alert histories for a given alert ID,
 * limiting to the given number of entries. Results are one entry per
 * evaluation window (grouped by createdAt), newest first.
 */
export async function getRecentAlertHistories({
  alertId,
  interval,
  limit,
}: {
  alertId: ObjectId;
  interval: AlertInterval;
  limit: number;
}): Promise<Omit<IAlertHistory, 'alert'>[]> {
  // One extra interval of slack so a window sitting exactly `limit` intervals
  // back (the newest window is up to one interval old) isn't cut off by the
  // lookback bound.
  const lookbackMs = (limit + 1) * intervalToMs(interval);
  return fetchGroupedWindows(
    alertId,
    { $gte: new Date(Date.now() - lookbackMs) },
    limit,
  );
}

type AlertEvaluationGroupEntry = {
  group: string;
  state: AlertState;
  counts: number;
  /** The group's most recent bucket value in this window, if any. */
  lastValue?: { startTime: Date; count: number };
  /** True when a notification was actually sent for this group. */
  fired?: boolean;
};

type AlertEvaluationEntry = Omit<IAlertHistory, 'alert'> & {
  /**
   * Per-group breakdown for group-by alerts, firing-first, capped at
   * ALERT_EVALUATION_GROUPS_LIMIT. Absent for non-grouped alerts.
   */
  groups?: AlertEvaluationGroupEntry[];
  /** Total number of groups evaluated in this window (before the cap). */
  groupsTotal?: number;
};

export type AlertEvaluationsPage = {
  data: AlertEvaluationEntry[];
  /** True when older windows may exist within [startTime, ...). */
  hasMore: boolean;
  /** Cursor for the next-older page (pass as `before`). Set when hasMore. */
  nextBefore?: Date;
};

// One AlertHistory row's fields, as pushed into a per-window sub-array by the
// evaluations aggregation (unlike the alerts-page pipeline, group identity is
// preserved so windows can be broken down per group).
type EvaluationWindowRow = {
  group?: string;
  state: AlertState;
  counts?: number;
  lastValues?: IAlertHistory['lastValues'];
  fired?: boolean;
  errors?: IAlertError[];
  analytics?: IAlertHistoryAnalytics;
};

type StructuredWindow = {
  _id: Date;
  rows: EvaluationWindowRow[];
};

// Firing-first ordering for the per-group breakdown.
const groupStatePriority = (state: AlertState): number => {
  switch (state) {
    case AlertState.ALERT:
      return 0;
    case AlertState.PENDING:
      return 1;
    default:
      return 2;
  }
};

/**
 * Pick the evaluation analytics for a window. A window's rows all carry the
 * same evaluation-level analytics, except when it contains rows from two
 * evaluations (a failed attempt's ERROR row + the successful retry's rows) —
 * prefer the successful evaluation's. For rows written before analytics
 * existed, `backfilledBuckets` is derived from the distinct bucket times so
 * the "Backfilled Buckets" column works on historical data.
 */
function resolveWindowAnalytics(
  rows: EvaluationWindowRow[],
  lastValues: IAlertHistory['lastValues'],
): IAlertHistoryAnalytics | undefined {
  const analytics =
    rows.find(r => r.state !== AlertState.ERROR && r.analytics != null)
      ?.analytics ?? rows.find(r => r.analytics != null)?.analytics;

  if (analytics?.backfilledBuckets != null) {
    return analytics;
  }

  const distinctBuckets = new Set(lastValues.map(v => v.startTime.getTime()))
    .size;
  const derivedBackfilled = Math.max(0, distinctBuckets - 1);
  if (analytics == null && derivedBackfilled === 0) {
    return undefined;
  }
  return { ...analytics, backfilledBuckets: derivedBackfilled };
}

function mapStructuredWindow(window: StructuredWindow): AlertEvaluationEntry {
  const rows = window.rows ?? [];
  const errors = dedupeErrors(
    rows.flatMap(r => r.errors ?? []).filter(e => e != null),
  );
  const lastValues = rows
    .flatMap(r => r.lastValues ?? [])
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const analytics = resolveWindowAnalytics(rows, lastValues);

  // Per-group breakdown: rows carrying a group identity. ERROR rows never
  // carry one (they record the evaluation failure, not a group result).
  const groupRows = rows.filter(
    r => r.group != null && r.group !== '' && r.state !== AlertState.ERROR,
  );
  const groups = groupRows
    .map(r => {
      const groupLastValues = r.lastValues ?? [];
      const lastValue =
        groupLastValues.length > 0
          ? groupLastValues.reduce((latest, v) =>
              v.startTime.getTime() > latest.startTime.getTime() ? v : latest,
            )
          : undefined;
      return {
        group: r.group as string,
        state: r.state,
        counts: r.counts ?? 0,
        ...(lastValue != null && { lastValue }),
        ...(r.fired != null && { fired: r.fired }),
      };
    })
    .sort(
      (a, b) =>
        groupStatePriority(a.state) - groupStatePriority(b.state) ||
        (b.lastValue?.count ?? Number.NEGATIVE_INFINITY) -
          (a.lastValue?.count ?? Number.NEGATIVE_INFINITY) ||
        a.group.localeCompare(b.group),
    );

  return {
    createdAt: window._id,
    state: groupStateToOverallState(rows.map(r => r.state)),
    counts: rows.reduce((sum, r) => sum + (r.counts ?? 0), 0),
    lastValues,
    ...(errors.length > 0 && { errors }),
    ...(analytics != null && { analytics }),
    ...(groups.length > 0 && {
      groups: groups.slice(0, ALERT_EVALUATION_GROUPS_LIMIT),
      groupsTotal: groups.length,
    }),
  };
}

/**
 * Fetch evaluation windows (one entry per createdAt, newest first) within the
 * createdAt bounds, capped at `limit` windows, preserving per-group rows so
 * grouped alerts can be broken down per group.
 */
async function fetchStructuredWindows(
  alertId: ObjectId,
  createdAt: Record<string, Date>,
  limit: number,
): Promise<AlertEvaluationEntry[]> {
  const windows = await AlertHistory.aggregate<StructuredWindow>([
    {
      $match: {
        alert: new ObjectId(alertId),
        createdAt,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$createdAt',
        rows: {
          $push: {
            group: '$group',
            state: '$state',
            counts: '$counts',
            lastValues: '$lastValues',
            fired: '$fired',
            errors: '$errors',
            analytics: '$analytics',
          },
        },
      },
    },
    {
      $sort: {
        _id: -1,
      },
    },
    {
      $limit: limit,
    },
  ]);

  return windows.map(mapStructuredWindow);
}

/**
 * Paginated evaluation windows for the alert detail page, newest first,
 * scoped to [startTime, endTime].
 *
 * Every request scans a hard-bounded slice of at most ~(limit + 1) intervals
 * of history (anchored at `before ?? endTime`), so a wide time range can
 * never force an unbounded scan — group-by alerts can have many rows per
 * window, and the $group stage processes every matched row.
 *
 * Because of that bound, a page may end before reaching `startTime` even if
 * fewer than `limit` windows were returned (a gap with no evaluations). The
 * returned `nextBefore` cursor always advances past the scanned slice, so
 * callers can keep paging across gaps: pass it as `before` on the next call.
 */
export async function getAlertEvaluations({
  alertId,
  interval,
  limit,
  startTime,
  endTime,
  before,
}: {
  alertId: ObjectId;
  interval: AlertInterval;
  limit: number;
  startTime: Date;
  endTime: Date;
  before?: Date;
}): Promise<AlertEvaluationsPage> {
  const intervalMs = intervalToMs(interval);
  // One extra interval of slack so a window sitting exactly `limit` intervals
  // back isn't cut off by the scan bound.
  const scanMs = (limit + 1) * intervalMs;

  // Upper bound: the page cursor when provided (exclusive), else the range
  // end (inclusive). A cursor past the range end is ignored.
  const usableBefore =
    before != null && before.getTime() <= endTime.getTime()
      ? before
      : undefined;
  const pageEndMs = usableBefore?.getTime() ?? endTime.getTime();

  // Lower bound: the scan bound, clamped to the requested range start.
  const scanFloorMs = Math.max(startTime.getTime(), pageEndMs - scanMs);

  const createdAt: Record<string, Date> = {
    $gte: new Date(scanFloorMs),
  };
  if (usableBefore != null) {
    createdAt.$lt = usableBefore;
  } else {
    createdAt.$lte = endTime;
  }

  // Fetch one extra window to detect count truncation.
  const windows = await fetchStructuredWindows(alertId, createdAt, limit + 1);

  const truncatedByCount = windows.length > limit;
  const data = truncatedByCount ? windows.slice(0, limit) : windows;
  // More windows may exist when the page filled up, or when the scan bound
  // stopped before reaching the range start.
  const truncatedByScanBound = scanFloorMs > startTime.getTime();
  const hasMore = truncatedByCount || truncatedByScanBound;

  // Count truncation: resume strictly before the last returned window.
  // Scan-bound truncation: the slice down to scanFloor (inclusive) is fully
  // covered, so resume strictly before it.
  const nextBefore = !hasMore
    ? undefined
    : truncatedByCount
      ? data[data.length - 1].createdAt
      : new Date(scanFloorMs);

  return { data, hasMore, nextBefore };
}

/**
 * Batch-fetch recent alert histories for multiple alerts in parallel.
 *
 * Uses per-alert queries with concurrency control instead of a single
 * $in-based aggregation. This avoids the $in + $sort anti-pattern that
 * breaks index-backed sorting in DocumentDB, while eliminating the N+1
 * query pattern from the caller.
 *
 * Each per-alert query uses the compound index {alert: 1, createdAt: -1}
 * for an efficient single-range index scan.
 */
export async function getRecentAlertHistoriesBatch(
  alerts: { alertId: ObjectId; interval: AlertInterval }[],
  limit: number,
): Promise<Map<string, Omit<IAlertHistory, 'alert'>[]>> {
  const queue = new PQueue({ concurrency: ALERT_HISTORY_QUERY_CONCURRENCY });

  const entries = await Promise.all(
    alerts.map(({ alertId, interval }) =>
      queue.add(async () => {
        const histories = await getRecentAlertHistories({
          alertId,
          interval,
          limit,
        });
        return [alertId.toString(), histories] as const;
      }),
    ),
  );

  return new Map(
    entries.filter(
      (e): e is [string, Omit<IAlertHistory, 'alert'>[]] => e !== undefined,
    ),
  );
}

/**
 * Returns alert firing/recovery transitions (ALERT-boundary crossings) within
 * [startTime, endTime] for one alert, for drawing chart annotations. Each
 * transition carries `bucketStart` — the start of the newest bucket the
 * transitioning evaluation covered — so markers land on the data point that
 * produced the transition (charts plot buckets at their start, while the
 * evaluation runs at the bucket end). One window before startTime is fetched
 * to know the state on entry: if the alert is already firing then, a firing
 * marker is pinned to startTime so a later in-range recovery isn't orphaned.
 * PENDING/INSUFFICIENT_DATA count as non-firing, so only ALERT crossings are
 * reported.
 */
export async function getAlertTransitionsInRange({
  alertId,
  interval,
  startTime,
  endTime,
}: {
  alertId: ObjectId;
  interval: AlertInterval;
  startTime: Date;
  endTime: Date;
}): Promise<AlertTransition[]> {
  const intervalMs = intervalToMs(interval);
  const lookbackStart = new Date(startTime.getTime() - intervalMs);

  // Per-window state detects crossings; the newest evaluated bucket start
  // positions the marker where the chart plots that bucket's value. ERROR rows
  // are failed evaluations, not state observations — excluding them prevents a
  // query failure mid-firing from drawing a false recovery annotation.
  const windows = await AlertHistory.aggregate<{
    _id: Date;
    states: string[];
    // Newest lastValues.startTime across the window's rows (one per group for
    // group-by alerts); null when no row carries lastValues.
    lastBucketStart: Date | null;
  }>([
    {
      $match: {
        alert: new ObjectId(alertId),
        createdAt: { $gte: lookbackStart, $lte: endTime },
        state: { $ne: AlertState.ERROR },
      },
    },
    {
      $group: {
        _id: '$createdAt',
        states: { $push: '$state' },
        // Inner $max traverses each row's lastValues array; the accumulator
        // takes the max across rows and ignores nulls (empty arrays).
        lastBucketStart: { $max: { $max: '$lastValues.startTime' } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const transitions: AlertTransition[] = [];
  // Assume "not firing" before the earliest known window, so an alert whose
  // history begins already in ALERT still yields a firing marker.
  let prevIsAlert = false;
  let enteredRange = false;

  // Pin a firing marker to the range start if the alert was already firing on
  // entry (carried in from before startTime). The marker is synthetic ("firing
  // when the window opens"), so it carries no bucketStart of its own.
  const pinCarryInIfFiring = () => {
    if (prevIsAlert) {
      transitions.push({
        createdAt: startTime.toISOString(),
        state: AlertState.ALERT,
        bucketStart: startTime.toISOString(),
      });
    }
  };

  for (const evalWindow of windows) {
    const isAlert =
      groupStateToOverallState(evalWindow.states) === AlertState.ALERT;
    const inRange = evalWindow._id >= startTime;

    if (inRange && !enteredRange) {
      enteredRange = true;
      pinCarryInIfFiring();
    }

    if (inRange && isAlert !== prevIsAlert) {
      // Fall back to createdAt − interval when the window has no lastValues
      // (mirrors the evaluation table's fallback for failed evaluations).
      const bucketStart =
        evalWindow.lastBucketStart ??
        new Date(evalWindow._id.getTime() - intervalMs);
      transitions.push({
        createdAt: evalWindow._id.toISOString(),
        state: isAlert ? AlertState.ALERT : AlertState.OK,
        bucketStart: bucketStart.toISOString(),
      });
    }

    prevIsAlert = isAlert;
  }

  // No window landed inside the range (e.g. the alert interval is wider than
  // the dashboard window) but the pre-range state was firing — pin it anyway.
  if (!enteredRange) {
    pinCarryInIfFiring();
  }

  return transitions;
}
