import mongoose from 'mongoose';
import ms from 'ms';

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
  alertId: mongoose.Types.ObjectId;
  limit: number;
}): Promise<Omit<IAlertHistory, 'alert'>[]> {
  const thirtyDaysAgo = new Date(Date.now() - ms('30d'));

  const histories = await AlertHistory.find({
    alert: new mongoose.Types.ObjectId(alertId),
    createdAt: { $gte: thirtyDaysAgo },
  })
    .sort({ createdAt: -1 })
    .lean();

  // Group by createdAt timestamp
  const grouped = new Map<number, GroupedAlertHistory>();
  for (const h of histories) {
    const key = h.createdAt.getTime();
    const existing = grouped.get(key);
    if (existing) {
      existing.states.push(h.state);
      existing.counts += h.counts;
      existing.lastValues.push(h.lastValues);
    } else {
      grouped.set(key, {
        _id: h.createdAt,
        states: [h.state],
        counts: h.counts,
        lastValues: [h.lastValues],
      });
    }
  }

  // Sort by date descending and take limit
  const result = [...grouped.values()]
    .sort((a, b) => b._id.getTime() - a._id.getTime())
    .slice(0, limit);

  return result.map(group => ({
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
