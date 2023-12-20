import { getHours, getMinutes } from 'date-fns';
import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import { SQLSerializer } from '@/clickhouse/searchQueryParser';
import Alert, {
  AlertChannel,
  AlertInterval,
  AlertSource,
  AlertType,
  IAlert,
} from '@/models/alert';

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
    source: alert.source,
    channel: alert.channel,
    interval: alert.interval,
    type: alert.type,
    threshold: alert.threshold,
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

export const createAlert = async (alertInput: AlertInput) => {
  return new Alert(makeAlert(alertInput)).save();
};

// create an update alert function based off of the above create alert function
export const updateAlert = async (id: string, alertInput: AlertInput) => {
  return Alert.findByIdAndUpdate(id, makeAlert(alertInput), {
    returnDocument: 'after',
  });
};
