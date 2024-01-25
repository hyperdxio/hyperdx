// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import * as fns from 'date-fns';
import * as fnsTz from 'date-fns-tz';
import { isString } from 'lodash';
import ms from 'ms';
import { serializeError } from 'serialize-error';
import { URLSearchParams } from 'url';
import { z } from 'zod';

import * as clickhouse from '@/clickhouse';
import * as config from '@/config';
import { ObjectId } from '@/models';
import Alert, { AlertDocument, AlertState } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import Dashboard, { IDashboard } from '@/models/dashboard';
import LogView from '@/models/logView';
import { ITeam } from '@/models/team';
import Webhook from '@/models/webhook';
import { convertMsToGranularityString, truncateString } from '@/utils/common';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';

type EnhancedDashboard = Omit<IDashboard, 'team'> & { team: ITeam };

const MAX_MESSAGE_LENGTH = 500;

const getLogViewEnhanced = async (logViewId: ObjectId) => {
  const logView = await LogView.findById(logViewId).populate<{
    team: ITeam;
  }>('team');
  if (!logView) {
    throw new Error(`LogView ${logViewId} not found `);
  }
  return logView;
};

export const buildLogSearchLink = ({
  endTime,
  logView,
  q,
  startTime,
}: {
  endTime: Date;
  logView: Awaited<ReturnType<typeof getLogViewEnhanced>>;
  q?: string;
  startTime: Date;
}) => {
  const url = new URL(`${config.FRONTEND_URL}/search/${logView._id}`);
  const queryParams = new URLSearchParams({
    from: startTime.getTime().toString(),
    to: endTime.getTime().toString(),
  });
  if (q) {
    queryParams.append('q', q);
  }
  url.search = queryParams.toString();
  return url.toString();
};

// TODO: should link to the chart instead
export const buildChartLink = ({
  dashboardId,
  endTime,
  granularity,
  startTime,
}: {
  dashboardId: string;
  endTime: Date;
  granularity: string;
  startTime: Date;
}) => {
  const url = new URL(`${config.FRONTEND_URL}/dashboards/${dashboardId}`);
  // extend both start and end time by 7x granularity
  const from = (startTime.getTime() - ms(granularity) * 7).toString();
  const to = (endTime.getTime() + ms(granularity) * 7).toString();
  const queryParams = new URLSearchParams({
    from,
    granularity: convertMsToGranularityString(ms(granularity)),
    to,
  });
  url.search = queryParams.toString();
  return url.toString();
};

const buildChartEventSlackMessage = ({
  alert,
  dashboard,
  endTime,
  granularity,
  group,
  startTime,
  totalCount,
}: {
  alert: AlertDocument;
  endTime: Date;
  dashboard: EnhancedDashboard;
  granularity: string;
  group?: string;
  startTime: Date;
  totalCount: number;
}) => {
  // should be only 1 chart
  const chart = dashboard.charts[0];
  const mrkdwn = [
    `*<${buildChartLink({
      dashboardId: dashboard._id.toString(),
      endTime,
      granularity,
      startTime,
    })} | Alert for "${chart.name}" in "${dashboard.name}">*`,
    ...(group != null ? [`Group: "${group}"`] : []),
    `${totalCount} ${
      doesExceedThreshold(alert, totalCount) ? 'exceeds' : 'falls below'
    } ${alert.threshold}`,
  ].join('\n');

  return {
    text: `Alert for "${chart.name}" in "${dashboard.name}" - ${totalCount} ${
      doesExceedThreshold(alert, totalCount) ? 'exceeds' : 'falls below'
    } ${alert.threshold}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: mrkdwn,
        },
      },
    ],
  };
};

const buildLogEventSlackMessage = async ({
  alert,
  endTime,
  group,
  logView,
  startTime,
  totalCount,
}: {
  alert: AlertDocument;
  endTime: Date;
  group?: string;
  logView: Awaited<ReturnType<typeof getLogViewEnhanced>>;
  startTime: Date;
  totalCount: number;
}) => {
  const searchQuery = alert.groupBy
    ? `${logView.query} ${alert.groupBy}:"${group}"`
    : logView.query;
  // TODO: show group + total count for group-by alerts
  const results = await clickhouse.getLogBatch({
    endTime: endTime.getTime(),
    limit: 5,
    offset: 0,
    order: 'desc',
    q: searchQuery,
    startTime: startTime.getTime(),
    tableVersion: logView.team.logStreamTableVersion,
    teamId: logView.team._id.toString(),
  });

  const mrkdwn = [
    `*<${buildLogSearchLink({
      endTime,
      logView,
      q: searchQuery,
      startTime,
    })} | Alert for ${logView.name}>*`,
    ...(group != null ? [`Group: "${group}"`] : []),
    `${totalCount} lines found, expected ${
      alert.type === 'presence' ? 'less than' : 'greater than'
    } ${alert.threshold} lines`,
    ...(results?.rows != null && totalCount > 0
      ? [
          `\`\`\``,
          truncateString(
            results.data
              .map(row => {
                return `${fnsTz.formatInTimeZone(
                  new Date(row.timestamp),
                  'Etc/UTC',
                  'MMM d HH:mm:ss',
                )}Z [${row.severity_text}] ${truncateString(
                  row.body,
                  MAX_MESSAGE_LENGTH,
                )}`;
              })
              .join('\n'),
            2500,
          ),
          `\`\`\``,
        ]
      : []),
  ].join('\n');

  return {
    text: `Alert for ${logView.name} - ${totalCount} lines found`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: mrkdwn,
        },
      },
    ],
  };
};

const fireChannelEvent = async ({
  alert,
  dashboard,
  endTime,
  group,
  logView,
  startTime,
  totalCount,
  windowSizeInMins,
}: {
  alert: AlertDocument;
  logView: Awaited<ReturnType<typeof getLogViewEnhanced>> | null;
  dashboard: EnhancedDashboard | null;
  endTime: Date;
  group?: string;
  startTime: Date;
  totalCount: number;
  windowSizeInMins: number;
}) => {
  switch (alert.channel.type) {
    case 'webhook': {
      const webhook = await Webhook.findOne({
        _id: alert.channel.webhookId,
      });
      // ONLY SUPPORTS SLACK WEBHOOKS FOR NOW
      if (webhook?.service === 'slack') {
        let message: {
          text: string;
          blocks?: {
            type: string;
            text: {
              type: string;
              text: string;
            };
          }[];
        } | null = null;

        if (alert.source === 'LOG' && logView) {
          message = await buildLogEventSlackMessage({
            alert,
            endTime,
            group,
            logView,
            startTime,
            totalCount,
          });
        } else if (alert.source === 'CHART' && dashboard) {
          message = buildChartEventSlackMessage({
            alert,
            dashboard,
            endTime,
            granularity: `${windowSizeInMins} minute`,
            group,
            startTime,
            totalCount,
          });
        }

        if (message !== null) {
          await slack.postMessageToWebhook(webhook.url, message);
        } else {
          logger.error({
            alert,
            dashboard,
            logView,
            message: 'Unsupported alert source',
          });
        }
      }
      break;
    }
    default:
      throw new Error(
        `Unsupported channel type: ${(alert.channel as any).any}`,
      );
  }
};

export const doesExceedThreshold = (
  alert: AlertDocument,
  totalCount: number,
) => {
  if (alert.type === 'presence' && totalCount >= alert.threshold) {
    return true;
  } else if (alert.type === 'absence' && totalCount < alert.threshold) {
    return true;
  }
  return false;
};

export const roundDownTo = (roundTo: number) => (x: Date) =>
  new Date(Math.floor(x.getTime() / roundTo) * roundTo);
export const roundDownToXMinutes = (x: number) => roundDownTo(1000 * 60 * x);

export const processAlert = async (now: Date, alert: AlertDocument) => {
  try {
    const previous: IAlertHistory | undefined = (
      await AlertHistory.find({ alert: alert._id })
        .sort({ createdAt: -1 })
        .limit(1)
    )[0];

    const windowSizeInMins = ms(alert.interval) / 60000;
    const nowInMinsRoundDown = roundDownToXMinutes(windowSizeInMins)(now);
    if (
      previous &&
      fns.getTime(previous.createdAt) === fns.getTime(nowInMinsRoundDown)
    ) {
      logger.info({
        message: `Skipped to check alert since the time diff is still less than 1 window size`,
        windowSizeInMins,
        nowInMinsRoundDown,
        previous,
        now,
        alert,
      });
      return;
    }
    const checkStartTime = previous
      ? previous.createdAt
      : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins);
    const checkEndTime = nowInMinsRoundDown;

    // Logs Source
    let checksData:
      | Awaited<ReturnType<typeof clickhouse.checkAlert>>
      | Awaited<ReturnType<typeof clickhouse.getMultiSeriesChartLegacyFormat>>
      | null = null;
    let logView: Awaited<ReturnType<typeof getLogViewEnhanced>> | null = null;
    let targetDashboard: EnhancedDashboard | null = null;
    if (alert.source === 'LOG' && alert.logView) {
      logView = await getLogViewEnhanced(alert.logView);
      // TODO: use getLogsChart instead so we can deprecate checkAlert
      checksData = await clickhouse.checkAlert({
        endTime: checkEndTime,
        groupBy: alert.groupBy,
        q: logView.query,
        startTime: checkStartTime,
        tableVersion: logView.team.logStreamTableVersion,
        teamId: logView.team._id.toString(),
        windowSizeInMins,
      });
      logger.info({
        message: 'Received alert metric [LOG source]',
        alert,
        logView,
        checksData,
        checkStartTime,
        checkEndTime,
      });
    }
    // Chart Source
    else if (alert.source === 'CHART' && alert.dashboardId && alert.chartId) {
      const dashboard = await Dashboard.findOne(
        {
          _id: alert.dashboardId,
          'charts.id': alert.chartId,
        },
        {
          name: 1,
          charts: {
            $elemMatch: {
              id: alert.chartId,
            },
          },
        },
      ).populate<{
        team: ITeam;
      }>('team');

      if (
        dashboard &&
        Array.isArray(dashboard.charts) &&
        dashboard.charts.length === 1
      ) {
        const chart = dashboard.charts[0];
        // Doesn't work for metric alerts yet
        const MAX_NUM_GROUPS = 20;
        // TODO: assuming that the chart has only 1 series for now
        const firstSeries = chart.series[0];
        if (firstSeries.type === 'time' && firstSeries.table === 'logs') {
          targetDashboard = dashboard;
          const startTimeMs = fns.getTime(checkStartTime);
          const endTimeMs = fns.getTime(checkEndTime);

          checksData = await clickhouse.getMultiSeriesChartLegacyFormat({
            series: chart.series,
            endTime: endTimeMs,
            granularity: `${windowSizeInMins} minute`,
            maxNumGroups: MAX_NUM_GROUPS,
            startTime: startTimeMs,
            tableVersion: dashboard.team.logStreamTableVersion,
            teamId: dashboard.team._id.toString(),
            seriesReturnType: chart.seriesReturnType,
          });
        } else if (
          firstSeries.type === 'time' &&
          firstSeries.table === 'metrics' &&
          firstSeries.field
        ) {
          targetDashboard = dashboard;
          const startTimeMs = fns.getTime(checkStartTime);
          const endTimeMs = fns.getTime(checkEndTime);
          checksData = await clickhouse.getMultiSeriesChartLegacyFormat({
            series: chart.series.map(series => {
              if ('field' in series && series.field != null) {
                const [metricName, rawMetricDataType] =
                  series.field.split(' - ');
                const metricDataType = z
                  .nativeEnum(clickhouse.MetricsDataType)
                  .parse(rawMetricDataType);
                return {
                  ...series,
                  metricDataType,
                  field: metricName,
                };
              }
              return series;
            }),
            endTime: endTimeMs,
            granularity: `${windowSizeInMins} minute`,
            maxNumGroups: MAX_NUM_GROUPS,
            startTime: startTimeMs,
            tableVersion: dashboard.team.logStreamTableVersion,
            teamId: dashboard.team._id.toString(),
            seriesReturnType: chart.seriesReturnType,
          });
        }
      }

      logger.info({
        message: 'Received alert metric [CHART source]',
        alert,
        checksData,
        checkStartTime,
        checkEndTime,
      });
    } else {
      logger.error({
        message: `Unsupported alert source: ${alert.source}`,
        alert,
      });
      return;
    }

    // TODO: support INSUFFICIENT_DATA state
    let alertState = AlertState.OK;
    const history = await new AlertHistory({
      alert: alert._id,
      createdAt: nowInMinsRoundDown,
      state: alertState,
    }).save();
    if (checksData?.rows && checksData?.rows > 0) {
      for (const checkData of checksData.data) {
        const totalCount = isString(checkData.data)
          ? parseInt(checkData.data)
          : checkData.data;
        const bucketStart = new Date(checkData.ts_bucket * 1000);
        if (doesExceedThreshold(alert, totalCount)) {
          alertState = AlertState.ALERT;
          logger.info({
            message: `Triggering ${alert.channel.type} alarm!`,
            alert,
            totalCount,
            checkData,
          });

          try {
            await fireChannelEvent({
              alert,
              dashboard: targetDashboard,
              endTime: fns.addMinutes(bucketStart, windowSizeInMins),
              group: Array.isArray(checkData.group)
                ? checkData.group.join(', ')
                : checkData.group,
              logView,
              startTime: bucketStart,
              totalCount,
              windowSizeInMins,
            });
          } catch (e) {
            logger.error({
              message: 'Failed to fire channel event',
              alert,
              error: serializeError(e),
            });
          }

          history.counts += 1;
        }
        history.lastValues.push({ count: totalCount, startTime: bucketStart });
      }

      history.state = alertState;
      await history.save();
    }

    alert.state = alertState;
    await alert.save();
  } catch (e) {
    // Uncomment this for better error messages locally
    // console.error(e);
    logger.error({
      message: 'Failed to process alert',
      alert,
      error: serializeError(e),
    });
  }
};

export default async () => {
  const now = new Date();
  const alerts = await Alert.find({});
  logger.info(`Going to process ${alerts.length} alerts`);
  await Promise.all(alerts.map(alert => processAlert(now, alert)));
};
