import {
  ALERT_INTERVAL_TO_MINUTES,
  AlertInterval,
} from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';

import { AlertState } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';

type GroupedAlertHistory = {
  _id: Date;
  states: string[];
  counts: number;
  lastValues: IAlertHistory['lastValues'][];
};

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
