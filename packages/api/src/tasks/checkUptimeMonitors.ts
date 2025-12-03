import axios, { AxiosError } from 'axios';
import https from 'https';
import ms from 'ms';
import { serializeError } from 'serialize-error';

import { connectDB } from '@/models';
import { AlertState } from '@/models/alert';
import UptimeCheckHistory from '@/models/uptimeCheckHistory';
import UptimeMonitor, {
  IUptimeMonitor,
  UptimeMonitorStatus,
} from '@/models/uptimeMonitor';
import Webhook, { IWebhook } from '@/models/webhook';
import { handleSendGenericWebhook } from '@/tasks/checkAlerts/template';
import { tasksTracer } from '@/tasks/tracer';
import { CheckUptimeMonitorsTaskArgs, HdxTask } from '@/tasks/types';
import logger from '@/utils/logger';

const performUptimeCheck = async (monitor: IUptimeMonitor) => {
  const startTime = Date.now();
  let status = UptimeMonitorStatus.UP;
  let responseTime: number | undefined;
  let statusCode: number | undefined;
  let error: string | undefined;
  let metadata: any = {};

  try {
    const axiosConfig = {
      method: monitor.method,
      url: monitor.url,
      timeout: monitor.timeout,
      headers: monitor.headers || {},
      data: monitor.body,
      validateStatus: () => true, // Don't throw on any status code
      maxRedirects: 5,
      httpsAgent: new https.Agent({
        rejectUnauthorized: monitor.verifySsl ?? true,
      }),
    };

    const response = await axios(axiosConfig);
    responseTime = Date.now() - startTime;
    statusCode = response.status;

    // Check if status code is expected
    const expectedCodes = monitor.expectedStatusCodes || [200];
    if (!expectedCodes.includes(statusCode)) {
      status = UptimeMonitorStatus.DOWN;
      error = `Unexpected status code: ${statusCode}. Expected: ${expectedCodes.join(', ')}`;
    }

    // Check if response time exceeds threshold
    if (
      monitor.expectedResponseTime &&
      responseTime > monitor.expectedResponseTime
    ) {
      status = UptimeMonitorStatus.DEGRADED;
      error = `Response time ${responseTime}ms exceeds threshold ${monitor.expectedResponseTime}ms`;
    }

    // Check if response body contains expected string
    if (monitor.expectedBodyContains) {
      const responseBody = String(response.data);
      if (!responseBody.includes(monitor.expectedBodyContains)) {
        status = UptimeMonitorStatus.DOWN;
        error = `Response body does not contain expected string: "${monitor.expectedBodyContains}"`;
      }
    }

    // Extract SSL certificate info if available
    if (monitor.url.startsWith('https://')) {
      // Note: SSL certificate validation is handled by the httpsAgent
      // We could extract more detailed SSL info here if needed
      metadata.sslValid = monitor.verifySsl ? true : undefined;
    }
  } catch (err: any) {
    responseTime = Date.now() - startTime;
    status = UptimeMonitorStatus.DOWN;

    if (axios.isAxiosError(err)) {
      const axiosError = err as AxiosError;
      if (axiosError.code === 'ECONNABORTED') {
        error = `Request timeout after ${monitor.timeout}ms`;
      } else if (axiosError.code === 'ENOTFOUND') {
        error = `DNS lookup failed for ${monitor.url}`;
      } else if (axiosError.code === 'ECONNREFUSED') {
        error = `Connection refused to ${monitor.url}`;
      } else {
        error = axiosError.message;
      }
    } else {
      error = err.message || 'Unknown error';
    }

    logger.error(
      {
        monitorId: monitor.id,
        error: serializeError(err),
      },
      'Uptime check failed',
    );
  }

  return {
    status,
    responseTime,
    statusCode,
    error,
    metadata,
  };
};

const sendNotification = async (
  monitor: IUptimeMonitor,
  previousStatus: UptimeMonitorStatus | undefined,
  currentStatus: UptimeMonitorStatus,
  responseTime: number | undefined,
  error: string | undefined,
  teamWebhooksById: Map<string, IWebhook>,
) => {
  // Only send notification if status changed from UP to DOWN/DEGRADED or vice versa
  const shouldNotify =
    (previousStatus === UptimeMonitorStatus.UP &&
      (currentStatus === UptimeMonitorStatus.DOWN ||
        currentStatus === UptimeMonitorStatus.DEGRADED)) ||
    ((previousStatus === UptimeMonitorStatus.DOWN ||
      previousStatus === UptimeMonitorStatus.DEGRADED) &&
      currentStatus === UptimeMonitorStatus.UP);

  if (!shouldNotify) {
    return;
  }

  if (!monitor.notificationChannel || monitor.notificationChannel.type !== 'webhook') {
    return;
  }

  const webhook = teamWebhooksById.get(monitor.notificationChannel.webhookId);
  if (!webhook) {
    logger.warn(
      {
        monitorId: monitor.id,
        webhookId: monitor.notificationChannel.webhookId,
      },
      'Webhook not found for uptime monitor notification',
    );
    return;
  }

  const isDown = currentStatus === UptimeMonitorStatus.DOWN || currentStatus === UptimeMonitorStatus.DEGRADED;
  const title = isDown
    ? `🔴 Uptime Monitor Alert: ${monitor.name}`
    : `✅ Uptime Monitor Recovered: ${monitor.name}`;

  const body = isDown
    ? `Monitor "${monitor.name}" is ${currentStatus.toLowerCase()}.\n\nURL: ${monitor.url}\nMethod: ${monitor.method}\nResponse Time: ${responseTime ? `${responseTime}ms` : 'N/A'}\nError: ${error || 'N/A'}`
    : `Monitor "${monitor.name}" has recovered and is now UP.\n\nURL: ${monitor.url}\nMethod: ${monitor.method}\nResponse Time: ${responseTime}ms`;

  const now = Date.now();

  try {
    await handleSendGenericWebhook(webhook, {
      hdxLink: `${process.env.FRONTEND_URL || ''}/uptime-monitors`,
      title,
      body,
      state: isDown ? AlertState.ALERT : AlertState.OK,
      startTime: now,
      endTime: now,
      eventId: `uptime-${monitor.id}-${now}`,
    });

    logger.info(
      {
        monitorId: monitor.id,
        status: currentStatus,
      },
      'Sent uptime monitor notification',
    );
  } catch (err) {
    logger.error(
      {
        monitorId: monitor.id,
        error: serializeError(err),
      },
      'Failed to send uptime monitor notification',
    );
  }
};

export default class CheckUptimeMonitorsTask
  implements HdxTask<CheckUptimeMonitorsTaskArgs>
{
  constructor(private args: CheckUptimeMonitorsTaskArgs) {}

  async execute(): Promise<void> {
    if (this.args.taskName !== 'check-uptime-monitors') {
      throw new Error(
        `CheckUptimeMonitorsTask can only handle 'check-uptime-monitors' tasks, received: ${this.args.taskName}`,
      );
    }

    // Connect to MongoDB
    try {
      await connectDB();
      logger.debug('Connected to MongoDB for uptime checks');
    } catch (error: any) {
      logger.error(
        {
          error: {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
          },
        },
        `Failed to connect to MongoDB: ${error?.message || String(error)}`,
      );
      throw error;
    }

    await tasksTracer.startActiveSpan('checkUptimeMonitors', async span => {
      try {
        const now = new Date();

        // Find all monitors that need to be checked
        const monitors = await UptimeMonitor.find({
          $or: [
            { paused: false },
            { paused: { $exists: false } },
            {
              paused: true,
              pausedUntil: { $lte: now },
            },
          ],
        });

        logger.info(
          {
            monitorCount: monitors.length,
          },
          'Checking uptime monitors',
        );

        // Group monitors by team to fetch webhooks
        const teamIds = new Set(monitors.map(m => m.team.toString()));
        const teamWebhooksMap = new Map<string, Map<string, IWebhook>>();

        for (const teamId of teamIds) {
          const webhooks = await Webhook.find({ team: teamId });
          const webhookMap = new Map(webhooks.map(w => [w.id, w]));
          teamWebhooksMap.set(teamId, webhookMap);
        }

        // Check each monitor
        for (const monitor of monitors) {
          // Resume monitor if pause period has expired
          if (monitor.paused && monitor.pausedUntil && monitor.pausedUntil <= now) {
            monitor.paused = false;
            monitor.pausedBy = undefined;
            monitor.pausedAt = undefined;
            monitor.pausedUntil = undefined;
            await monitor.save();
          }

          // Skip if still paused
          if (monitor.paused) {
            continue;
          }

          // Check if it's time to run this monitor based on interval
          const intervalMs = ms(monitor.interval);
          if (
            monitor.lastCheckedAt &&
            now.getTime() - monitor.lastCheckedAt.getTime() < intervalMs
          ) {
            continue;
          }

          await tasksTracer.startActiveSpan(
            'checkUptimeMonitor',
            async innerSpan => {
              innerSpan.setAttribute('hyperdx.monitor.id', monitor.id);
              innerSpan.setAttribute('hyperdx.monitor.url', monitor.url);

              try {
                const previousStatus = monitor.lastStatus;

                // Perform the check
                const result = await performUptimeCheck(monitor);

                // Save check history
                await new UptimeCheckHistory({
                  monitor: monitor._id,
                  status: result.status,
                  responseTime: result.responseTime,
                  statusCode: result.statusCode,
                  error: result.error,
                  checkedAt: now,
                  metadata: result.metadata,
                }).save();

                // Update monitor
                monitor.lastCheckedAt = now;
                monitor.lastStatus = result.status;
                monitor.lastResponseTime = result.responseTime;
                monitor.lastError = result.error;
                monitor.status = result.status;
                await monitor.save();

                // Send notification if status changed
                const teamWebhooks =
                  teamWebhooksMap.get(monitor.team.toString()) || new Map();
                await sendNotification(
                  monitor,
                  previousStatus,
                  result.status,
                  result.responseTime,
                  result.error,
                  teamWebhooks,
                );

                logger.info(
                  {
                    monitorId: monitor.id,
                    status: result.status,
                    responseTime: result.responseTime,
                  },
                  'Uptime check completed',
                );
              } catch (err) {
                logger.error(
                  {
                    monitorId: monitor.id,
                    error: serializeError(err),
                  },
                  'Failed to check uptime monitor',
                );
              } finally {
                innerSpan.end();
              }
            },
          );
        }

        logger.info('Finished checking uptime monitors');
      } finally {
        span.end();
      }
    });
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {
    // No cleanup needed
  }
}

