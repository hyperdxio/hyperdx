import { ObjectId } from 'mongodb';
import { z } from 'zod';

import UptimeMonitor, {
  IUptimeMonitor,
  UptimeMonitorInterval,
  UptimeMonitorMethod,
  UptimeMonitorStatus,
} from '@/models/uptimeMonitor';
import UptimeCheckHistory from '@/models/uptimeCheckHistory';

export type UptimeMonitorInput = {
  id?: string;
  name: string;
  url: string;
  method?: UptimeMonitorMethod;
  interval?: UptimeMonitorInterval;
  timeout?: number;
  notificationChannel?: {
    type: 'webhook' | null;
    webhookId?: string;
  };
  headers?: Record<string, string>;
  body?: string;
  expectedStatusCodes?: number[];
  expectedResponseTime?: number;
  expectedBodyContains?: string;
  verifySsl?: boolean;
};

const makeUptimeMonitor = (
  input: UptimeMonitorInput,
  userId?: ObjectId,
): Partial<IUptimeMonitor> => {
  return {
    name: input.name,
    url: input.url,
    method: input.method ?? UptimeMonitorMethod.GET,
    interval: input.interval ?? UptimeMonitorInterval.FIVE_MINUTES,
    timeout: input.timeout ?? 10000,
    notificationChannel: input.notificationChannel,
    headers: input.headers,
    body: input.body,
    expectedStatusCodes: input.expectedStatusCodes ?? [200],
    expectedResponseTime: input.expectedResponseTime,
    expectedBodyContains: input.expectedBodyContains,
    verifySsl: input.verifySsl ?? true,
    ...(userId && { createdBy: userId }),
  };
};

export const createUptimeMonitor = async (
  teamId: ObjectId,
  input: UptimeMonitorInput,
  userId: ObjectId,
) => {
  return new UptimeMonitor({
    ...makeUptimeMonitor(input, userId),
    team: teamId,
    status: UptimeMonitorStatus.UP,
  }).save();
};

export const updateUptimeMonitor = async (
  id: string,
  teamId: ObjectId,
  input: UptimeMonitorInput,
) => {
  return UptimeMonitor.findOneAndUpdate(
    {
      _id: id,
      team: teamId,
    },
    makeUptimeMonitor(input),
    {
      returnDocument: 'after',
    },
  );
};

export const getUptimeMonitors = async (teamId: ObjectId) => {
  return UptimeMonitor.find({ team: teamId }).populate('createdBy', 'email name');
};

export const getUptimeMonitorById = async (
  monitorId: ObjectId | string,
  teamId: ObjectId | string,
) => {
  return UptimeMonitor.findOne({
    _id: monitorId,
    team: teamId,
  });
};

export const deleteUptimeMonitor = async (id: string, teamId: ObjectId) => {
  // Delete the monitor and its history
  await UptimeCheckHistory.deleteMany({ monitor: id });
  return UptimeMonitor.deleteOne({
    _id: id,
    team: teamId,
  });
};

export const pauseUptimeMonitor = async (
  id: string,
  teamId: ObjectId,
  userId: ObjectId,
  pausedUntil?: Date,
) => {
  return UptimeMonitor.findOneAndUpdate(
    {
      _id: id,
      team: teamId,
    },
    {
      paused: true,
      pausedBy: userId,
      pausedAt: new Date(),
      pausedUntil,
      status: UptimeMonitorStatus.PAUSED,
    },
    {
      returnDocument: 'after',
    },
  );
};

export const resumeUptimeMonitor = async (id: string, teamId: ObjectId) => {
  return UptimeMonitor.findOneAndUpdate(
    {
      _id: id,
      team: teamId,
    },
    {
      paused: false,
      pausedBy: undefined,
      pausedAt: undefined,
      pausedUntil: undefined,
      status: UptimeMonitorStatus.UP,
    },
    {
      returnDocument: 'after',
    },
  );
};

export const getUptimeCheckHistory = async (
  monitorId: string,
  teamId: ObjectId | string,
  limit: number = 100,
) => {
  // Verify the monitor belongs to the team
  const monitor = await getUptimeMonitorById(monitorId, teamId);
  if (!monitor) {
    throw new Error('Monitor not found');
  }

  return UptimeCheckHistory.find({ monitor: monitorId })
    .sort({ checkedAt: -1 })
    .limit(limit);
};

export const getUptimeStats = async (
  monitorId: string,
  teamId: ObjectId | string,
  startDate: Date,
  endDate: Date,
) => {
  // Verify the monitor belongs to the team
  const monitor = await getUptimeMonitorById(monitorId, teamId);
  if (!monitor) {
    throw new Error('Monitor not found');
  }

  const history = await UptimeCheckHistory.find({
    monitor: monitorId,
    checkedAt: { $gte: startDate, $lte: endDate },
  }).sort({ checkedAt: 1 });

  const totalChecks = history.length;
  const upChecks = history.filter(h => h.status === UptimeMonitorStatus.UP).length;
  const downChecks = history.filter(h => h.status === UptimeMonitorStatus.DOWN).length;
  const degradedChecks = history.filter(
    h => h.status === UptimeMonitorStatus.DEGRADED,
  ).length;

  const responseTimes = history
    .filter(h => h.responseTime != null)
    .map(h => h.responseTime!);

  const avgResponseTime =
    responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

  const maxResponseTime =
    responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
  const minResponseTime =
    responseTimes.length > 0 ? Math.min(...responseTimes) : 0;

  const uptime = totalChecks > 0 ? (upChecks / totalChecks) * 100 : 100;

  return {
    totalChecks,
    upChecks,
    downChecks,
    degradedChecks,
    uptime,
    avgResponseTime,
    maxResponseTime,
    minResponseTime,
    history,
  };
};

