import PQueue from '@esm2cjs/p-queue';
import {
  ALERT_INTERVAL_TO_MINUTES,
  AlertInterval,
  AlertTransition,
} from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';

import { AlertState } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';

// Max parallel per-alert queries to avoid overwhelming the DB connection pool
export const ALERT_HISTORY_QUERY_CONCURRENCY = 20;

type GroupedAlertHistory = {
  _id: Date;
  states: string[];
  counts: number;
  lastValues: IAlertHistory['lastValues'][];
};

function groupStateToOverallState(states: string[]): AlertState {
  if (states.includes(AlertState.ALERT)) {
    return AlertState.ALERT;
  }

  if (states.includes(AlertState.PENDING)) {
    return AlertState.PENDING;
  }

  return AlertState.OK;
}

function mapGroupedHistories(
  groupedHistories: GroupedAlertHistory[],
): Omit<IAlertHistory, 'alert'>[] {
  return groupedHistories.map(group => ({
    createdAt: group._id,
    state: groupStateToOverallState(group.states),
    counts: group.counts,
    lastValues: group.lastValues
      .flat()
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
  }));
}

/**
 * Gets the most recent alert histories for a given alert ID,
 * limiting to the given number of entries.
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
  const lookbackMs = limit * ALERT_INTERVAL_TO_MINUTES[interval] * 60 * 1000;

  const groupedHistories = await AlertHistory.aggregate<GroupedAlertHistory>([
    {
      $match: {
        alert: new ObjectId(alertId),
        createdAt: { $gte: new Date(Date.now() - lookbackMs) },
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
 * [startTime, endTime] for one alert, for drawing chart annotations. One window
 * before startTime is fetched to know the state on entry: if the alert is
 * already firing then, a firing marker is pinned to startTime so a later
 * in-range recovery isn't orphaned. PENDING/INSUFFICIENT_DATA count as
 * non-firing, so only ALERT crossings are reported.
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
  const intervalMs = ALERT_INTERVAL_TO_MINUTES[interval] * 60 * 1000;
  const lookbackStart = new Date(startTime.getTime() - intervalMs);

  // Only the per-window state is needed to detect crossings.
  const windows = await AlertHistory.aggregate<{ _id: Date; states: string[] }>(
    [
      {
        $match: {
          alert: new ObjectId(alertId),
          createdAt: { $gte: lookbackStart, $lte: endTime },
        },
      },
      { $group: { _id: '$createdAt', states: { $push: '$state' } } },
      { $sort: { _id: 1 } },
    ],
  );

  const transitions: AlertTransition[] = [];
  // Assume "not firing" before the earliest known window, so an alert whose
  // history begins already in ALERT still yields a firing marker.
  let prevIsAlert = false;
  let enteredRange = false;

  for (const evalWindow of windows) {
    const isAlert =
      groupStateToOverallState(evalWindow.states) === AlertState.ALERT;
    const inRange = evalWindow._id >= startTime;

    // On entry into the range, pin a firing marker to startTime if the alert
    // was already firing (carried in from before the range).
    if (inRange && !enteredRange) {
      enteredRange = true;
      if (prevIsAlert) {
        transitions.push({
          createdAt: startTime.toISOString(),
          state: AlertState.ALERT,
        });
      }
    }

    if (inRange && isAlert !== prevIsAlert) {
      transitions.push({
        createdAt: evalWindow._id.toISOString(),
        state: isAlert ? AlertState.ALERT : AlertState.OK,
      });
    }

    prevIsAlert = isAlert;
  }

  return transitions;
}
