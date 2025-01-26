import { sign, verify } from 'jsonwebtoken';
import { groupBy } from 'lodash';
import ms from 'ms';
import { z } from 'zod';

import type { ObjectId } from '@/models';
import Alert, {
  AlertChannel,
  AlertInterval,
  AlertSource,
  AlertThresholdType,
  IAlert,
} from '@/models/alert';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { IUser } from '@/models/user';
import logger from '@/utils/logger';
import { alertSchema } from '@/utils/zod';

export type AlertInput = {
  source?: AlertSource;
  channel: AlertChannel;
  interval: AlertInterval;
  thresholdType: AlertThresholdType;
  threshold: number;

  // Message template
  name?: string | null;
  message?: string | null;

  // Log alerts
  groupBy?: string;
  savedSearchId?: string;

  // Chart alerts
  dashboardId?: string;
  tileId?: string;

  // Silenced
  silenced?: {
    by?: ObjectId;
    at: Date;
    until: Date;
  };
};

const makeAlert = (alert: AlertInput): Partial<IAlert> => {
  return {
    channel: alert.channel,
    interval: alert.interval,
    source: alert.source,
    threshold: alert.threshold,
    thresholdType: alert.thresholdType,

    // Message template
    // If they're undefined/null, set it to null so we clear out the field
    // due to mongoose behavior:
    // https://mongoosejs.com/docs/migrating_to_6.html#removed-omitundefined
    name: alert.name == null ? null : alert.name,
    message: alert.message == null ? null : alert.message,

    // Log alerts
    savedSearch: alert.savedSearchId as unknown as ObjectId,
    groupBy: alert.groupBy,
    // Chart alerts
    dashboard: alert.dashboardId as unknown as ObjectId,
    tileId: alert.tileId,
  };
};

export const createAlert = async (
  teamId: ObjectId,
  alertInput: z.infer<typeof alertSchema>,
) => {
  if (alertInput.source === AlertSource.TILE) {
    if ((await Dashboard.findById(alertInput.dashboardId)) == null) {
      throw new Error('Dashboard ID not found');
    }
  }

  if (alertInput.source === AlertSource.SAVED_SEARCH) {
    if ((await SavedSearch.findById(alertInput.savedSearchId)) == null) {
      throw new Error('Saved Search ID not found');
    }
  }

  return new Alert({
    ...makeAlert(alertInput),
    team: teamId,
  }).save();
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

export const getDashboardAlerts = async (
  dashboardIds: string[] | null,
  teamId: ObjectId,
) => {
  const alerts = await Alert.find({
    ...(dashboardIds !== null && {
      dashboard: { $in: dashboardIds },
    }),
    source: 'tile',
    team: teamId,
  });
  return groupBy(alerts, 'tileId');
};

export const createOrUpdateDashboardAlerts = async (
  dashboardId: ObjectId | string,
  teamId: ObjectId,
  alertsByTile: Record<string, AlertInput>,
) => {
  return Promise.all(
    Object.entries(alertsByTile).map(async ([tileId, alert]) => {
      return await Alert.findOneAndUpdate(
        {
          dashboard: dashboardId,
          tileId,
          source: AlertSource.TILE,
          team: teamId,
        },
        alert,
        { new: true, upsert: true },
      );
    }),
  );
};

export const deleteDashboardAlerts = async (
  dashboardId: ObjectId | string,
  teamId: ObjectId,
  alertIds?: string[],
) => {
  return Alert.deleteMany({
    dashboard: dashboardId,
    team: teamId,
    ...(alertIds && { _id: { $in: alertIds } }),
  });
};

export const getAlertsEnhanced = async (teamId: ObjectId) => {
  return Alert.find({ team: teamId }).populate<{
    savedSearch: ISavedSearch;
    dashboard: IDashboard;
    silenced?: IAlert['silenced'] & {
      by: IUser;
    };
  }>(['savedSearch', 'dashboard', 'silenced.by']);
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
