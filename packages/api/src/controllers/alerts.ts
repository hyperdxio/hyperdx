import { getHours, getMinutes } from 'date-fns';
import { sign, verify } from 'jsonwebtoken';
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
import logger from '@/utils/logger';
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

export const getAlertById = async (alertId: string, teamId: ObjectId) => {
  const [logViewIds, dashboardIds] = await dashboardLogViewIds(teamId);

  return Alert.findOne({
    _id: alertId,
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

export const generateSignedAlertSilenceToken = async (
  id: string,
  teamId: ObjectId,
) => {
  const secret = process.env.EXPRESS_SESSION_SECRET;

  if (!secret) {
    logger.error(
      'EXPRESS_SESSION_SECRET is not set for signing token, skipping alert silence JWT generation',
    );
    return '';
  }

  const alert = await getAlertById(id, teamId);
  if (alert == null) {
    throw new Error('Alert not found');
  }

  const token = sign(
    { silenceAlertId: alert._id.toString() },
    process.env.EXPRESS_SESSION_SECRET,
    {
      expiresIn: '1h',
    },
  );

  // Slack does not accept ids longer than 255 characters
  if (token.length > 255) {
    logger.error(
      'Alert silence JWT length is greater than 255 characters, this may cause issues with some clients.',
    );
  }

  return token;
};

export const silenceAlertFromTokenAndTeam = async (
  token: string,
  teamId: ObjectId,
) => {
  const secret = process.env.EXPRESS_SESSION_SECRET;

  if (!secret) {
    throw new Error('EXPRESS_SESSION_SECRET is not set for verifying token');
  }

  const decoded = verify(token, process.env.EXPRESS_SESSION_SECRET, {
    algorithms: ['HS256'],
  });
  const alertId = (decoded as { silenceAlertId: string }).silenceAlertId;

  if (alertId == null) {
    throw new Error('Invalid token');
  }

  const alert = await getAlertById(alertId, teamId);
  if (alert == null) {
    throw new Error('Alert not found');
  }

  alert.silencedUntil = new Date(Date.now() + ms('30m'));
  return alert.save();
};
