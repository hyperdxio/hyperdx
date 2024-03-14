// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import * as fns from 'date-fns';
import * as fnsTz from 'date-fns-tz';
import Handlebars, { HelperOptions } from 'handlebars';
import PromisedHandlebars from 'promised-handlebars';
import _ from 'lodash';
import mongoose from 'mongoose';
import ms from 'ms';
import { URLSearchParams } from 'url';
import { escapeRegExp, isString } from 'lodash';
import { serializeError } from 'serialize-error';
import { z } from 'zod';

import * as clickhouse from '@/clickhouse';
import * as config from '@/config';
import { ObjectId } from '@/models';
import Alert, { AlertDocument, AlertState } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import Dashboard, { IDashboard } from '@/models/dashboard';
import LogView from '@/models/logView';
import { ITeam } from '@/models/team';
import Webhook, { IWebhook } from '@/models/webhook';
import { convertMsToGranularityString, truncateString } from '@/utils/common';
import { translateDashboardDocumentToExternalDashboard } from '@/utils/externalApi';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';
import {
  externalAlertSchema,
  translateAlertDocumentToExternalAlert,
} from '@/utils/zod';

type EnhancedDashboard = Omit<IDashboard, 'team'> & { team: ITeam };

const MAX_MESSAGE_LENGTH = 500;
const NOTIFY_FN_NAME = '__hdx_notify_channel__';
const IS_MATCH_FN_NAME = 'is_match';

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
  logViewId,
  q,
  startTime,
}: {
  endTime: Date;
  logViewId: string;
  q?: string;
  startTime: Date;
}) => {
  const url = new URL(`${config.FRONTEND_URL}/search/${logViewId}`);
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

export const doesExceedThreshold = (
  isThresholdTypeAbove: boolean,
  threshold: number,
  value: number,
) => {
  if (isThresholdTypeAbove && value >= threshold) {
    return true;
  } else if (!isThresholdTypeAbove && value < threshold) {
    return true;
  }
  return false;
};

// transfer keys of attributes with dot into nested object
// ex: { 'a.b': 'c', 'd.e.f': 'g' } -> { a: { b: 'c' }, d: { e: { f: 'g' } } }
export const expandToNestedObject = (
  obj: Record<string, string>,
  separator = '.',
  maxDepth = 10,
) => {
  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const keys = key.split(separator);
      let nestedObj = result;

      for (let i = 0; i < keys.length; i++) {
        if (i >= maxDepth) {
          break;
        }
        const nestedKey = keys[i];
        if (i === keys.length - 1) {
          nestedObj[nestedKey] = obj[key];
        } else {
          nestedObj[nestedKey] = nestedObj[nestedKey] || {};
          nestedObj = nestedObj[nestedKey];
        }
      }
    }
  }
  return result;
};

// ------------------------------------------------------------
// ----------------- Alert Message Template -------------------
// ------------------------------------------------------------
// should match the external alert schema
type AlertMessageTemplateDefaultView = {
  // FIXME: do we want to include groupBy in the external alert schema?
  alert: z.infer<typeof externalAlertSchema> & { groupBy?: string };
  attributes: Record<string, string>;
  dashboard: ReturnType<
    typeof translateDashboardDocumentToExternalDashboard
  > | null;
  endTime: Date;
  granularity: string;
  group?: string;
  // TODO: use a translation function ?
  savedSearch: {
    id: string;
    name: string;
    query: string;
  } | null;
  startTime: Date;
  value: number;
};
export const notifyChannel = async ({
  channel,
  id,
  message,
  team,
}: {
  channel: AlertMessageTemplateDefaultView['alert']['channel']['type'];
  id: string;
  message: {
    hdxLink: string;
    title: string;
    body: string;
  };
  team: {
    id: string;
  };
}) => {
  switch (channel) {
    case 'slack_webhook': {
      const webhook = await Webhook.findOne({
        team: team.id,
        ...(mongoose.isValidObjectId(id)
          ? { _id: id }
          : {
              name: {
                $regex: new RegExp(`^${escapeRegExp(id)}`), // FIXME: a hacky way to match the prefix
              },
            }),
      });

      if (webhook?.service === 'slack') {
        await handleSendSlackWebhook(webhook, message);
      } else if (webhook?.service === 'generic') {
        await handleSendGenericWebhook(webhook, message);
      }
      break;
    }
    default:
      throw new Error(`Unsupported channel type: ${channel}`);
  }
};

const handleSendSlackWebhook = async (
  webhook: IWebhook,
  message: {
    hdxLink: string;
    title: string;
    body: string;
  },
) => {
  if (!webhook.url) {
    throw new Error('Webhook URL is not set');
  }

  await slack.postMessageToWebhook(webhook.url, {
    text: message.title,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${message.hdxLink} | ${message.title}>*\n${message.body}`,
        },
      },
    ],
  });
};

export const handleSendGenericWebhook = async (
  webhook: IWebhook,
  message: {
    hdxLink: string;
    title: string;
    body: string;
  },
) => {
  // QUERY PARAMS

  if (!webhook.url) {
    throw new Error('Webhook URL is not set');
  }

  let url: string;
  // user input of queryParams is disabled on the frontend for now
  if (webhook.queryParams) {
    // user may have included params in both the url and the query params
    // so they should be merged
    const tmpURL = new URL(webhook.url);
    for (const [key, value] of Object.entries(webhook.queryParams.toJSON())) {
      tmpURL.searchParams.append(key, value);
    }

    url = tmpURL.toString();
  } else {
    // if there are no query params given, just use the url
    url = webhook.url;
  }

  // HEADERS
  // TODO: handle real webhook security and signage after v0
  // X-HyperDX-Signature FROM PRIVATE SHA-256 HMAC, time based nonces, caching functionality etc

  const headers = {
    'Content-Type': 'application/json', // default, will be overwritten if user has set otherwise
    ...(webhook.headers?.toJSON() ?? {}),
  };

  // BODY

  let parsedBody: Record<string, string | number | symbol> = {};
  if (webhook.body) {
    const injectedBody = injectIntoPlaceholders(JSON.stringify(webhook.body), {
      $HDX_ALERT_URL: message.hdxLink,
      $HDX_ALERT_TITLE: message.title,
      $HDX_ALERT_BODY: message.body,
    });
    parsedBody = JSON.parse(injectedBody);
  }

  try {
    // TODO: retries/backoff etc -> switch to request-error-tolerant api client
    const response = await fetch(url, {
      method: 'POST',
      headers: headers as Record<string, string>,
      body: JSON.stringify(parsedBody),
    });

    if (!response.ok) {
      throw new Error('Failed to send generic webhook message');
    }
  } catch (e) {
    logger.error({
      message: 'Failed to send generic webhook message',
      error: serializeError(e),
    });
  }
};

type HDXGenericWebhookTemplateValues = {
  $HDX_ALERT_URL?: string;
  $HDX_ALERT_TITLE?: string;
  $HDX_ALERT_BODY?: string;
};

export function injectIntoPlaceholders(
  placeholderString: string,
  valuesToInject: HDXGenericWebhookTemplateValues,
) {
  return placeholderString.replace(/(\$\w+)/g, function (match) {
    const replacement =
      valuesToInject[match as keyof HDXGenericWebhookTemplateValues] || match;
    return escapeJsonValues(replacement);
  });
}

export function escapeJsonValues(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export const buildAlertMessageTemplateHdxLink = ({
  alert,
  dashboard,
  endTime,
  granularity,
  group,
  savedSearch,
  startTime,
}: AlertMessageTemplateDefaultView) => {
  if (alert.source === 'search') {
    if (savedSearch == null) {
      throw new Error('Source is LOG but logView is null');
    }
    const searchQuery = alert.groupBy
      ? `${savedSearch.query} ${alert.groupBy}:"${group}"`
      : savedSearch.query;
    return buildLogSearchLink({
      endTime,
      logViewId: savedSearch.id,
      q: searchQuery,
      startTime,
    });
  } else if (alert.source === 'chart') {
    if (dashboard == null) {
      throw new Error('Source is CHART but dashboard is null');
    }
    return buildChartLink({
      dashboardId: dashboard.id,
      endTime,
      granularity,
      startTime,
    });
  }

  throw new Error(`Unsupported alert source: ${(alert as any).source}`);
};
export const buildAlertMessageTemplateTitle = ({
  template,
  view,
}: {
  template?: string | null;
  view: AlertMessageTemplateDefaultView;
}) => {
  const { alert, dashboard, savedSearch, value } = view;
  const handlebars = Handlebars.create();
  if (alert.source === 'search') {
    if (savedSearch == null) {
      throw new Error('Source is LOG but logView is null');
    }
    // TODO: using template engine to render the title
    return template
      ? handlebars.compile(template)(view)
      : `Alert for "${savedSearch.name}" - ${value} lines found`;
  } else if (alert.source === 'chart') {
    if (dashboard == null) {
      throw new Error('Source is CHART but dashboard is null');
    }
    const chart = dashboard.charts[0];
    return template
      ? handlebars.compile(template)(view)
      : `Alert for "${chart.name}" in "${dashboard.name}" - ${value} ${
          doesExceedThreshold(
            alert.threshold_type === 'above',
            alert.threshold,
            value,
          )
            ? alert.threshold_type === 'above'
              ? 'exceeds'
              : 'falls below'
            : alert.threshold_type === 'above'
            ? 'falls below'
            : 'exceeds'
        } ${alert.threshold}`;
  }

  throw new Error(`Unsupported alert source: ${(alert as any).source}`);
};

export const getDefaultExternalAction = (
  alert: AlertMessageTemplateDefaultView['alert'],
) => {
  if (
    alert.channel.type === 'slack_webhook' &&
    alert.channel.webhookId != null
  ) {
    return `@${alert.channel.type}-${alert.channel.webhookId}`;
  }
  return null;
};

export const translateExternalActionsToInternal = (template: string) => {
  // ex: @webhook-1234_5678 -> "{{NOTIFY_FN_NAME channel="webhook" id="1234_5678}}"
  // ex: @webhook-{{attributes.webhookId}} -> "{{NOTIFY_FN_NAME channel="webhook" id="{{attributes.webhookId}}"}}"
  return template.replace(/(?:^|\s)@([a-zA-Z0-9.{}@_-]+)/g, (match, input) => {
    const prefix = match.startsWith(' ') ? ' ' : '';
    const [channel, ...ids] = input.split('-');
    const id = ids.join('-');
    // TODO: sanity check ??
    return `${prefix}{{${NOTIFY_FN_NAME} channel="${channel}" id="${id}"}}`;
  });
};

// this method will build the body of the alert message and will be used to send the alert to the channel
export const renderAlertTemplate = async ({
  template,
  title,
  view,
  team,
}: {
  template?: string | null;
  title: string;
  view: AlertMessageTemplateDefaultView;
  team: {
    id: string;
    logStreamTableVersion?: ITeam['logStreamTableVersion'];
  };
}) => {
  const { alert, dashboard, endTime, group, savedSearch, startTime, value } =
    view;

  const defaultExternalAction = getDefaultExternalAction(alert);
  const targetTemplate =
    defaultExternalAction !== null
      ? translateExternalActionsToInternal(
          `${template ?? ''} ${defaultExternalAction}`,
        ).trim()
      : translateExternalActionsToInternal(template ?? '');

  const isMatchFn = function (shouldRender: boolean) {
    return function (
      targetKey: string,
      targetValue: string,
      options: HelperOptions,
    ) {
      if (_.get(view, targetKey) === targetValue) {
        if (shouldRender) {
          return options.fn(this);
        } else {
          options.fn(this);
        }
      }
    };
  };
  const _hb = Handlebars.create();
  _hb.registerHelper(NOTIFY_FN_NAME, () => null);
  _hb.registerHelper(IS_MATCH_FN_NAME, isMatchFn(true));
  const hb = PromisedHandlebars(Handlebars);
  const registerHelpers = (rawTemplateBody: string) => {
    hb.registerHelper(IS_MATCH_FN_NAME, isMatchFn(false));

    hb.registerHelper(
      NOTIFY_FN_NAME,
      async (options: { hash: Record<string, string> }) => {
        const { channel, id } = options.hash;
        if (channel !== 'slack_webhook') {
          throw new Error(`Unsupported channel type: ${channel}`);
        }
        // render id template
        const renderedId = _hb.compile(id)(view);
        // render body template
        const renderedBody = _hb.compile(rawTemplateBody)(view);

        await notifyChannel({
          channel,
          id: renderedId,
          message: {
            hdxLink: buildAlertMessageTemplateHdxLink(view),
            title,
            body: renderedBody,
          },
          team,
        });
      },
    );
  };

  let rawTemplateBody;

  // TODO: support advanced routing with template engine
  // users should be able to use '@' syntax to trigger alerts
  if (alert.source === 'search') {
    if (savedSearch == null) {
      throw new Error('Source is LOG but logView is null');
    }
    const searchQuery = alert.groupBy
      ? `${savedSearch.query} ${alert.groupBy}:"${group}"`
      : savedSearch.query;
    // TODO: show group + total count for group-by alerts
    const results = await clickhouse.getLogBatch({
      endTime: endTime.getTime(),
      limit: 5,
      offset: 0,
      order: 'desc',
      q: searchQuery,
      startTime: startTime.getTime(),
      tableVersion: team.logStreamTableVersion,
      teamId: team.id,
    });
    const truncatedResults = truncateString(
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
    );
    rawTemplateBody = `${group ? `Group: "${group}"` : ''}
${value} lines found, expected ${
      alert.threshold_type === 'above' ? 'less than' : 'greater than'
    } ${alert.threshold} lines
${targetTemplate}
\`\`\`
${truncatedResults}
\`\`\``;
  } else if (alert.source === 'chart') {
    if (dashboard == null) {
      throw new Error('Source is CHART but dashboard is null');
    }
    rawTemplateBody = `${group ? `Group: "${group}"` : ''}
${value} ${
      doesExceedThreshold(
        alert.threshold_type === 'above',
        alert.threshold,
        value,
      )
        ? alert.threshold_type === 'above'
          ? 'exceeds'
          : 'falls below'
        : alert.threshold_type === 'above'
        ? 'falls below'
        : 'exceeds'
    } ${alert.threshold}
${targetTemplate}`;
  }

  // render the template
  if (rawTemplateBody) {
    registerHelpers(rawTemplateBody);
    const compiledTemplate = hb.compile(rawTemplateBody);
    return compiledTemplate(view);
  }

  throw new Error(`Unsupported alert source: ${(alert as any).source}`);
};
// ------------------------------------------------------------

const fireChannelEvent = async ({
  alert,
  attributes,
  dashboard,
  endTime,
  group,
  logView,
  startTime,
  totalCount,
  windowSizeInMins,
}: {
  alert: AlertDocument;
  attributes: Record<string, string>; // TODO: support other types than string
  dashboard: EnhancedDashboard | null;
  endTime: Date;
  group?: string;
  logView: Awaited<ReturnType<typeof getLogViewEnhanced>> | null;
  startTime: Date;
  totalCount: number;
  windowSizeInMins: number;
}) => {
  const team = logView?.team ?? dashboard?.team;
  if (team == null) {
    throw new Error('Team not found');
  }

  const attributesNested = expandToNestedObject(attributes);
  const templateView: AlertMessageTemplateDefaultView = {
    alert: {
      ...translateAlertDocumentToExternalAlert(alert),
      groupBy: alert.groupBy,
    },
    attributes: attributesNested,
    dashboard: dashboard
      ? translateDashboardDocumentToExternalDashboard({
          _id: dashboard._id,
          name: dashboard.name,
          query: dashboard.query,
          team: team._id,
          charts: dashboard.charts,
          tags: dashboard.tags,
        })
      : null,
    endTime,
    granularity: `${windowSizeInMins} minute`,
    group,
    savedSearch: logView
      ? {
          id: logView._id.toString(),
          name: logView.name,
          query: logView.query,
        }
      : null,
    startTime,
    value: totalCount,
  };

  await renderAlertTemplate({
    title: buildAlertMessageTemplateTitle({
      template: alert.name,
      view: templateView,
    }),
    template: alert.message,
    view: templateView,
    team: {
      id: team._id.toString(),
      logStreamTableVersion: team.logStreamTableVersion,
    },
  });
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
        if (
          doesExceedThreshold(
            alert.type === 'presence',
            alert.threshold,
            totalCount,
          )
        ) {
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
              attributes: checkData.attributes,
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
