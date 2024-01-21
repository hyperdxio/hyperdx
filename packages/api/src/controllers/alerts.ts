import { getHours, getMinutes } from 'date-fns';
import ms from 'ms';
import { z } from 'zod';

import * as clickhouse from '@/clickhouse';
import { SQLSerializer } from '@/clickhouse/searchQueryParser';
import type { ObjectId } from '@/models';
import Alert, {
  AlertChannel,
  AlertInterval,
  AlertSource,
  AlertType,
  IAlert,
} from '@/models/alert';
import Dashboard, { IDashboard } from '@/models/dashboard';
import LogView, { ILogView } from '@/models/logView';
import { alertSchema } from '@/utils/zod';

export type AlertInput = {
  source: AlertSource;
  channel: AlertChannel;
  interval: AlertInterval;
  type: AlertType;
  threshold: number;

  // Log alerts
  groupBy?: string;
  logViewId?: string;

  // Chart alerts
  dashboardId?: string;
  chartId?: string;
};

const getCron = (interval: AlertInterval) => {
  const now = new Date();
  const nowMins = getMinutes(now);
  const nowHours = getHours(now);

  switch (interval) {
    case '1m':
      return '* * * * *';
    case '5m':
      return '*/5 * * * *';
    case '15m':
      return '*/15 * * * *';
    case '30m':
      return '*/30 * * * *';
    case '1h':
      return `${nowMins} * * * *`;
    case '6h':
      return `${nowMins} */6 * * *`;
    case '12h':
      return `${nowMins} */12 * * *`;
    case '1d':
      return `${nowMins} ${nowHours} * * *`;
  }
};

export const validateGroupByProperty = async ({
  groupBy,
  logStreamTableVersion,
  teamId,
}: {
  groupBy: string;
  logStreamTableVersion: number | undefined;
  teamId: string;
}): Promise<boolean> => {
  const nowInMs = Date.now();
  const propertyTypeMappingsModel =
    await clickhouse.buildLogsPropertyTypeMappingsModel(
      logStreamTableVersion,
      teamId,
      nowInMs - ms('1d'),
      nowInMs,
    );
  const serializer = new SQLSerializer(propertyTypeMappingsModel);
  const { found } = await serializer.getColumnForField(groupBy);
  return !!found;
};

const makeAlert = (alert: AlertInput) => {
  return {
    channel: alert.channel,
    interval: alert.interval,
    source: alert.source,
    threshold: alert.threshold,
    type: alert.type,
    // Log alerts
    logView: alert.logViewId,
    groupBy: alert.groupBy,
    // Chart alerts
    dashboardId: alert.dashboardId,
    chartId: alert.chartId,
    cron: getCron(alert.interval),
    timezone: 'UTC', // TODO: support different timezone
  };
};

export const createAlert = async (
  teamId: ObjectId,
  alertInput: z.infer<typeof alertSchema>,
) => {
  if (alertInput.source === 'CHART') {
    if ((await Dashboard.findById(alertInput.dashboardId)) == null) {
      throw new Error('Dashboard ID not found');
    }
  }

  if (alertInput.source === 'LOG') {
    if ((await LogView.findById(alertInput.logViewId)) == null) {
      throw new Error('Saved Search ID not found');
    }
  }

  return new Alert({
    ...makeAlert(alertInput),
    team: teamId,
  }).save();
};

const dashboardLogViewIds = async (teamId: ObjectId) => {
  const [dashboards, logViews] = await Promise.all([
    Dashboard.find({ team: teamId }, { _id: 1 }),
    LogView.find({ team: teamId }, { _id: 1 }),
  ]);

  return [
    logViews.map(logView => logView._id),
    dashboards.map(dashboard => dashboard._id),
  ];
};

// create an update alert function based off of the above create alert function
export const updateAlert = async (
  id: string,
  teamId: ObjectId,
  alertInput: AlertInput,
) => {
  // should consider clearing AlertHistory when updating an alert?
  const [logViewIds, dashboardIds] = await dashboardLogViewIds(teamId);

  return Alert.findOneAndUpdate(
    {
      _id: id,
      $or: [
        {
          logView: {
            $in: logViewIds,
          },
        },
        {
          dashboardId: {
            $in: dashboardIds,
          },
        },
      ],
    },
    makeAlert(alertInput),
    {
      returnDocument: 'after',
    },
  );
};

export const getAlerts = async (teamId: ObjectId) => {
  const [logViewIds, dashboardIds] = await dashboardLogViewIds(teamId);

  return Alert.find({
    $or: [
      {
        logView: {
          $in: logViewIds,
        },
      },
      {
        dashboardId: {
          $in: dashboardIds,
        },
      },
    ],
  });
};

export const getAlertsWithLogViewAndDashboard = async (teamId: ObjectId) => {
  const [logViewIds, dashboardIds] = await dashboardLogViewIds(teamId);

  return Alert.find({
    $or: [
      {
        logView: {
          $in: logViewIds,
        },
      },
      {
        dashboardId: {
          $in: dashboardIds,
        },
      },
    ],
  }).populate<{
    logView: ILogView;
    dashboardId: IDashboard;
  }>(['logView', 'dashboardId']);
};

export const deleteAlert = async (id: string, teamId: ObjectId) => {
  const [logViewIds, dashboardIds] = await dashboardLogViewIds(teamId);

  return Alert.deleteOne({
    _id: id,
    $or: [
      {
        logView: {
          $in: logViewIds,
        },
      },
      {
        dashboardId: {
          $in: dashboardIds,
        },
      },
    ],
  });
};
