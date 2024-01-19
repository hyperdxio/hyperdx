import { getHours, getMinutes } from 'date-fns';
import mongoose from 'mongoose';
import ms from 'ms';
import z from 'zod';

import * as clickhouse from '@/clickhouse';
import { SQLSerializer } from '@/clickhouse/searchQueryParser';
import type { ObjectId } from '@/models';
import Alert, { AlertInterval, IAlert } from '@/models/alert';

// Input validation
const zChannel = z.object({
  type: z.literal('webhook'),
  webhookId: z.string().min(1),
});

const zLogAlert = z.object({
  source: z.literal('LOG'),
  groupBy: z.string().optional(),
  logView: z.string().min(1),
  message: z.string().optional(),
});

const zChartAlert = z.object({
  source: z.literal('CHART'),
  chartId: z.string().min(1),
  dashboardId: z.string().min(1),
});

export const zAlert = z
  .object({
    channel: zChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    threshold: z.number().min(0),
    type: z.enum(['presence', 'absence']),
    source: z.enum(['LOG', 'CHART']).default('LOG'),
  })
  .and(zLogAlert.or(zChartAlert));

export type AlertInput = Omit<IAlert, '_id' | 'cron' | 'timezone'>;

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

const makeAlert = (alert: AlertInput, team: ObjectId): Omit<IAlert, '_id'> => {
  return {
    channel: alert.channel,
    interval: alert.interval,
    source: alert.source,
    threshold: alert.threshold,
    type: alert.type,
    // Log alerts
    logView: alert.logView,
    groupBy: alert.groupBy,
    // Chart alerts
    dashboardId: new mongoose.Types.ObjectId(alert.dashboardId),
    chartId: alert.chartId,
    cron: getCron(alert.interval),
    timezone: 'UTC', // TODO: support different timezone
    state: alert.state,
    team: team,
  };
};

export const createAlert = async (teamId: ObjectId, alertInput: AlertInput) => {
  return new Alert({
    ...makeAlert(alertInput, teamId),
    team: teamId,
  }).save();
};

export const updateAlert = async (
  id: string,
  teamId: ObjectId,
  alertInput: AlertInput,
) => {
  const alert = await Alert.findOne({ _id: id, team: teamId });
  return alert?.updateOne(makeAlert(alertInput, teamId));
};

export const getAlert = async (id: string, teamId: ObjectId) => {
  return Alert.findOne({ _id: id, team: teamId });
};

export const getAllAlerts = async (teamId: ObjectId) => {
  return Alert.find({ team: teamId });
};

export const deleteAlert = async (id: string, teamId: ObjectId) => {
  const alert = await Alert.findOne({ _id: id, team: teamId });
  if (alert === null) {
    return null;
  }
  const result = await alert.remove();
  return alert;
};
