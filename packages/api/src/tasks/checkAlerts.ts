// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import { URLSearchParams } from 'url';

import * as fns from 'date-fns';
import * as fnsTz from 'date-fns-tz';
import ms from 'ms';
import { serializeError } from 'serialize-error';

import * as clickhouse from '../clickhouse';
import * as config from '../config';
import * as slack from '../utils/slack';
import Alert, { AlertState, IAlert, AlertSource } from '../models/alert';
import AlertHistory, { IAlertHistory } from '../models/alertHistory';
import LogView from '../models/logView';
import Webhook from '../models/webhook';
import logger from '../utils/logger';
import { ITeam } from '../models/team';
import { ObjectId } from '../models';
import { truncateString } from '../utils/common';

import type { ResponseJSON } from '@clickhouse/client';
import type { LogSearchRow } from '../clickhouse';

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

const buildEventSlackMessage = ({
  alert,
  endTime,
  group,
  logView,
  results,
  searchQuery,
  startTime,
  totalCount,
}: {
  alert: IAlert;
  endTime: Date;
  group?: string;
  logView: Awaited<ReturnType<typeof getLogViewEnhanced>>;
  results: ResponseJSON<LogSearchRow> | undefined;
  searchQuery?: string;
  startTime: Date;
  totalCount: number;
}) => {
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
  logView,
  totalCount,
  group,
  startTime,
  endTime,
}: {
  alert: IAlert;
  logView: Awaited<ReturnType<typeof getLogViewEnhanced>>;
  totalCount: number;
  group?: string;
  startTime: Date;
  endTime: Date;
}) => {
  const searchQuery = alert.groupBy
    ? `${logView.query} ${alert.groupBy}:"${group}"`
    : logView.query;
  // TODO: show group + total count for group-by alerts
  const results = await clickhouse.getLogBatch({
    endTime: endTime.getTime(),
    limit: 5,
    offset: 0,
    order: 'desc', // TODO: better to use null
    q: searchQuery,
    startTime: startTime.getTime(),
    tableVersion: logView.team.logStreamTableVersion,
    teamId: logView.team._id.toString(),
  });

  switch (alert.channel.type) {
    case 'webhook': {
      const webhook = await Webhook.findOne({
        _id: alert.channel.webhookId,
      });
      // ONLY SUPPORTS SLACK WEBHOOKS FOR NOW
      if (webhook.service === 'slack') {
        await slack.postMessageToWebhook(
          webhook.url,
          buildEventSlackMessage({
            alert,
            endTime,
            group,
            logView,
            results,
            searchQuery,
            startTime,
            totalCount,
          }),
        );
      }
      break;
    }
    default:
      throw new Error(
        `Unsupported channel type: ${(alert.channel as any).any}`,
      );
  }
};

const doesExceedThreshold = (alert: IAlert, totalCount: number) => {
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

const processAlert = async (now: Date, alert: IAlert) => {
  try {
    if (alert.source === AlertSource.CHART || !alert.logView) {
      logger.info({
        message: `[Not implemented] Skipping Chart alert processing`,
        alert,
      });
      return;
    }

    const logView = await getLogViewEnhanced(alert.logView);

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
        logView,
      });
      return;
    }
    const history = await new AlertHistory({
      alert: alert._id,
      createdAt: nowInMinsRoundDown,
    }).save();
    const checkStartTime = previous
      ? previous.createdAt
      : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins);
    const checkEndTime = nowInMinsRoundDown;
    const check = await clickhouse.checkAlert({
      endTime: checkEndTime,
      groupBy: alert.groupBy,
      q: logView.query,
      startTime: checkStartTime,
      tableVersion: logView.team.logStreamTableVersion,
      teamId: logView.team._id.toString(),
      windowSizeInMins,
    });

    logger.info({
      message: 'Received alert metric',
      alert,
      logView,
      check,
      checkStartTime,
      checkEndTime,
    });

    // TODO: support INSUFFICIENT_DATA state
    let alertState = AlertState.OK;
    if (check?.rows && check?.rows > 0) {
      for (const checkData of check.data) {
        const totalCount = parseInt(checkData.count);
        if (doesExceedThreshold(alert, totalCount)) {
          alertState = AlertState.ALERT;
          logger.info({
            message: `Triggering ${alert.channel.type} alarm!`,
            alert,
            logView,
            totalCount,
            checkData,
          });
          const bucketStart = new Date(checkData.ts_bucket);
          await fireChannelEvent({
            alert,
            logView,
            totalCount,
            group: checkData.group,
            startTime: bucketStart,
            endTime: fns.addMinutes(bucketStart, windowSizeInMins),
          });
          history.counts += 1;
        }
      }
      await history.save();
    }
    alert.state = alertState;
    await (alert as any).save();
  } catch (e) {
    // Uncomment this for better error messages locally
    // console.error(e);
    logger.error(serializeError(e));
  }
};

export default async () => {
  const now = new Date();
  const alerts = await Alert.find({});
  logger.info(`Going to process ${alerts.length} alerts`);
  await Promise.all(alerts.map(alert => processAlert(now, alert)));
};
