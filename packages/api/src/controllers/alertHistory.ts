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
  limit,
}: {
  alertId: ObjectId;
  limit: number;
}): Promise<Omit<IAlertHistory, 'alert'>[]> {
  const groupedHistories = await AlertHistory.aggregate<GroupedAlertHistory>([
    // Filter for the specific alert
    {
      $match: {
        alert: new ObjectId(alertId),
      },
    },
    // Group documents by createdAt
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
    // Take the `createdAtLimit` most recent groups
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
