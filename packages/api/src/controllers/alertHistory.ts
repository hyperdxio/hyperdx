import PQueue from '@esm2cjs/p-queue';
import {
  ALERT_INTERVAL_TO_MINUTES,
  AlertInterval,
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

function mapGroupedHistories(
  groupedHistories: GroupedAlertHistory[],
): Omit<IAlertHistory, 'alert'>[] {
  return groupedHistories.map(group => ({
    createdAt: group._id,
    state: group.states.includes(AlertState.ALERT)
      ? AlertState.ALERT
      : AlertState.OK,
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
