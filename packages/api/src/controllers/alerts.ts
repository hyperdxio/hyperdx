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
import { ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { IUser } from '@/models/user';
import logger from '@/utils/logger';
import { alertSchema } from '@/utils/zod';

export type AlertInput = {
  source: AlertSource;
  channel: AlertChannel;
  interval: AlertInterval;
  type: AlertType;
  threshold: number;

  // Message template
  name?: string | null;
  message?: string | null;

  // Log alerts
  groupBy?: string;
  savedSearchId?: string;

  // Chart alerts
  dashboardId?: string;
  chartId?: string;

  // Silenced
  silenced?: {
    by?: ObjectId;
    at: Date;
    until: Date;
  };
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

    // Message template
    // If they're undefined/null, set it to null so we clear out the field
    // due to mongoose behavior:
    // https://mongoosejs.com/docs/migrating_to_6.html#removed-omitundefined
    name: alert.name == null ? null : alert.name,
    message: alert.message == null ? null : alert.message,

    // Log alerts
    savedSearch: alert.savedSearchId,
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
    if ((await SavedSearch.findById(alertInput.savedSearchId)) == null) {
      throw new Error('Saved Search ID not found');
    }
  }

  return new Alert({
    ...makeAlert(alertInput),
    team: teamId,
  }).save();
};

const dashboardSavedSearchIds = async (teamId: ObjectId | string) => {
  const [dashboards, savedSearches] = await Promise.all([
    Dashboard.find({ team: teamId }, { _id: 1 }),
    SavedSearch.find({ team: teamId }, { _id: 1 }),
  ]);

  return [
    savedSearches.map(savedSearch => savedSearch._id),
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
  return Alert.findOneAndUpdate(
    {
      _id: id,
      team: teamId,
    },
    makeAlert(alertInput),
    {
      returnDocument: 'after',
    },
  );
};

export const getAlerts = async (teamId: ObjectId) => {
  return Alert.find({ team: teamId });
};

export const getAlertById = async (
  alertId: ObjectId | string,
  teamId: ObjectId | string,
) => {
  return Alert.findOne({
    _id: alertId,
    team: teamId,
  });
};

export const getAlertsWithLogViewAndDashboard = async (teamId: ObjectId) => {
  return Alert.find({ team: teamId }).populate<{
    savedSearch: ISavedSearch;
    dashboardId: IDashboard;
    silenced?: IAlert['silenced'] & {
      by: IUser;
    };
  }>(['savedSearch', 'dashboardId', 'silenced.by']);
};

export const deleteAlert = async (id: string, teamId: ObjectId) => {
  return Alert.deleteOne({
    _id: id,
    team: teamId,
  });
};

export const generateAlertSilenceToken = async (
  alertId: ObjectId | string,
  teamId: ObjectId | string,
) => {
  const secret = process.env.EXPRESS_SESSION_SECRET;

  if (!secret) {
    logger.error(
      'EXPRESS_SESSION_SECRET is not set for signing token, skipping alert silence JWT generation',
    );
    return '';
  }

  const alert = await getAlertById(alertId, teamId);
  if (alert == null) {
    throw new Error('Alert not found');
  }

  const token = sign(
    { alertId: alert._id.toString(), teamId: teamId.toString() },
    secret,
    { expiresIn: '1h' },
  );

  // Slack does not accept ids longer than 255 characters
  if (token.length > 255) {
    logger.error(
      'Alert silence JWT length is greater than 255 characters, this may cause issues with some clients.',
    );
  }

  return token;
};

export const silenceAlertByToken = async (token: string) => {
  const secret = process.env.EXPRESS_SESSION_SECRET;

  if (!secret) {
    throw new Error('EXPRESS_SESSION_SECRET is not set for verifying token');
  }

  const decoded = verify(token, secret, {
    algorithms: ['HS256'],
  }) as { alertId: string; teamId: string };

  if (!decoded?.alertId || !decoded?.teamId) {
    throw new Error('Invalid token');
  }

  const alert = await getAlertById(decoded.alertId, decoded.teamId);
  if (alert == null) {
    throw new Error('Alert not found');
  }

  alert.silenced = {
    at: new Date(),
    until: new Date(Date.now() + ms('30m')),
  };

  return alert.save();
};
