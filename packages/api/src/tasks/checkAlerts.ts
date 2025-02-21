// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import * as clickhouse from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata, Metadata } from '@hyperdx/common-utils/dist/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import * as fns from 'date-fns';
import Handlebars, { HelperOptions } from 'handlebars';
import _ from 'lodash';
import { escapeRegExp, isString } from 'lodash';
import mongoose from 'mongoose';
import ms from 'ms';
import PromisedHandlebars from 'promised-handlebars';
import { serializeError } from 'serialize-error';
import { URLSearchParams } from 'url';

import * as config from '@/config';
import { AlertInput } from '@/controllers/alerts';
import { getConnectionById } from '@/controllers/connection';
import Alert, {
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { ISource, Source } from '@/models/source';
import { ITeam } from '@/models/team';
import Webhook, { IWebhook } from '@/models/webhook';
import { convertMsToGranularityString, truncateString } from '@/utils/common';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';

const MAX_MESSAGE_LENGTH = 500;
const NOTIFY_FN_NAME = '__hdx_notify_channel__';
const IS_MATCH_FN_NAME = 'is_match';

const getAlerts = () =>
  Alert.find({}).populate<{
    team: ITeam;
  }>(['team']);

type EnhancedAlert = Awaited<ReturnType<typeof getAlerts>>[0];

export const buildLogSearchLink = ({
  endTime,
  savedSearch,
  startTime,
}: {
  endTime: Date;
  savedSearch: ISavedSearch;
  startTime: Date;
}) => {
  const url = new URL(`${config.FRONTEND_URL}/search/${savedSearch.id}`);
  const queryParams = new URLSearchParams({
    from: startTime.getTime().toString(),
    to: endTime.getTime().toString(),
    isLive: 'false',
    // do we need to fill more params here?
  });
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
  thresholdType: AlertThresholdType,
  threshold: number,
  value: number,
) => {
  const isThresholdTypeAbove = thresholdType === AlertThresholdType.ABOVE;
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
  const result: Record<string, any> = Object.create(null); // An object NOT inheriting from `Object.prototype`
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
export type AlertMessageTemplateDefaultView = {
  alert: AlertInput;
  attributes: ReturnType<typeof expandToNestedObject>;
  dashboard?: IDashboard | null;
  endTime: Date;
  granularity: string;
  group?: string;
  savedSearch?: ISavedSearch | null;
  source?: ISource | null;
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
    case 'webhook': {
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

export const escapeJsonString = (str: string) => {
  return JSON.stringify(str).slice(1, -1);
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
  let body = '';
  try {
    if (webhook.body) {
      const handlebars = Handlebars.create();
      body = handlebars.compile(webhook.body, {
        noEscape: true,
      })({
        body: escapeJsonString(message.body),
        link: escapeJsonString(message.hdxLink),
        title: escapeJsonString(message.title),
      });
    }
  } catch (e) {
    logger.error({
      message: 'Failed to compile generic webhook body',
      error: serializeError(e),
    });
    body = JSON.stringify({
      text: `${escapeJsonString(message.title)} | ${escapeJsonString(message.body)} | ${escapeJsonString(message.hdxLink)}`,
    });
  }

  try {
    // TODO: retries/backoff etc -> switch to request-error-tolerant api client
    const response = await fetch(url, {
      method: 'POST',
      headers: headers as Record<string, string>,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }
  } catch (e) {
    logger.error({
      message: 'Failed to send generic webhook message',
      error: serializeError(e),
    });
  }
};

export const buildAlertMessageTemplateHdxLink = ({
  alert,
  dashboard,
  endTime,
  granularity,
  savedSearch,
  startTime,
}: AlertMessageTemplateDefaultView) => {
  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source} but savedSearch is null`);
    }
    return buildLogSearchLink({
      endTime,
      savedSearch,
      startTime,
    });
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
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
  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source}  but savedSearch is null`);
    }
    // TODO: using template engine to render the title
    return template
      ? handlebars.compile(template)(view)
      : `Alert for "${savedSearch.name}" - ${value} lines found`;
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    const tile = dashboard.tiles[0];
    return template
      ? handlebars.compile(template)(view)
      : `Alert for "${tile.config.name}" in "${dashboard.name}" - ${value} ${
          doesExceedThreshold(alert.thresholdType, alert.threshold, value)
            ? alert.thresholdType === AlertThresholdType.ABOVE
              ? 'exceeds'
              : 'falls below'
            : alert.thresholdType === AlertThresholdType.ABOVE
              ? 'falls below'
              : 'exceeds'
        } ${alert.threshold}`;
  }

  throw new Error(`Unsupported alert source: ${(alert as any).source}`);
};

export const getDefaultExternalAction = (
  alert: AlertMessageTemplateDefaultView['alert'],
) => {
  if (alert.channel.type === 'webhook' && alert.channel.webhookId != null) {
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
  clickhouseClient,
  metadata,
  template,
  title,
  view,
  team,
}: {
  clickhouseClient: clickhouse.ClickhouseClient;
  metadata: Metadata;
  template?: string | null;
  title: string;
  view: AlertMessageTemplateDefaultView;
  team: {
    id: string;
  };
}) => {
  const {
    alert,
    dashboard,
    endTime,
    group,
    savedSearch,
    source,
    startTime,
    value,
  } = view;

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
      if (_.has(view, targetKey) && _.get(view, targetKey) === targetValue) {
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
        if (channel !== 'webhook') {
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
  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source} but savedSearch is null`);
    }
    if (source == null) {
      throw new Error(`Source ID is ${alert.source} but source is null`);
    }
    // TODO: show group + total count for group-by alerts
    // fetch sample logs
    const chartConfig: ChartConfigWithOptDateRange = {
      connection: '', // no need for the connection id since clickhouse client is already initialized
      displayType: DisplayType.Search,
      dateRange: [startTime, endTime],
      from: source.from,
      select: savedSearch.select ?? source.defaultTableSelectExpression,
      where: savedSearch.where,
      whereLanguage: savedSearch.whereLanguage,
      implicitColumnExpression: source.implicitColumnExpression,
      timestampValueExpression: source.timestampValueExpression,
      orderBy: savedSearch.orderBy,
      limit: {
        limit: 5,
        offset: 0,
      },
    };

    let truncatedResults = '';
    try {
      const query = await renderChartConfig(chartConfig, metadata);
      const raw = await clickhouseClient
        .query<'CSV'>({
          query: query.sql,
          query_params: query.params,
          format: 'CSV',
        })
        .then(res => res.text());

      const lines = raw.split('\n');

      truncatedResults = truncateString(
        lines.map(line => truncateString(line, MAX_MESSAGE_LENGTH)).join('\n'),
        2500,
      );
    } catch (e) {
      logger.error({
        message: 'Failed to fetch sample logs',
        savedSearchId: savedSearch.id,
        chartConfig,
        error: serializeError(e),
      });
    }

    rawTemplateBody = `${group ? `Group: "${group}"` : ''}
${value} lines found, expected ${
      alert.thresholdType === AlertThresholdType.ABOVE
        ? 'less than'
        : 'greater than'
    } ${alert.threshold} lines
${targetTemplate}
\`\`\`
${truncatedResults}
\`\`\``;
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    rawTemplateBody = `${group ? `Group: "${group}"` : ''}
${value} ${
      doesExceedThreshold(alert.thresholdType, alert.threshold, value)
        ? alert.thresholdType === AlertThresholdType.ABOVE
          ? 'exceeds'
          : 'falls below'
        : alert.thresholdType === AlertThresholdType.ABOVE
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
  clickhouseClient,
  dashboard,
  endTime,
  group,
  metadata,
  savedSearch,
  source,
  startTime,
  totalCount,
  windowSizeInMins,
}: {
  alert: EnhancedAlert;
  attributes: Record<string, string>; // TODO: support other types than string
  clickhouseClient: clickhouse.ClickhouseClient;
  dashboard?: IDashboard | null;
  endTime: Date;
  group?: string;
  metadata: Metadata;
  savedSearch?: ISavedSearch | null;
  source?: ISource | null;
  startTime: Date;
  totalCount: number;
  windowSizeInMins: number;
}) => {
  const team = alert.team;
  if (team == null) {
    throw new Error('Team not found');
  }

  if ((alert.silenced?.until?.getTime() ?? 0) > Date.now()) {
    logger.info({
      message: 'Skipped firing alert due to silence',
      alertId: alert.id,
      silenced: alert.silenced,
    });
    return;
  }

  const attributesNested = expandToNestedObject(attributes);
  const templateView: AlertMessageTemplateDefaultView = {
    alert: {
      channel: alert.channel,
      dashboardId: dashboard?.id,
      groupBy: alert.groupBy,
      interval: alert.interval,
      message: alert.message,
      name: alert.name,
      savedSearchId: savedSearch?.id,
      silenced: alert.silenced,
      source: alert.source,
      threshold: alert.threshold,
      thresholdType: alert.thresholdType,
      tileId: alert.tileId,
    },
    attributes: attributesNested,
    dashboard,
    endTime,
    granularity: `${windowSizeInMins} minute`,
    group,
    savedSearch,
    source,
    startTime,
    value: totalCount,
  };

  await renderAlertTemplate({
    clickhouseClient,
    metadata,
    title: buildAlertMessageTemplateTitle({
      template: alert.name,
      view: templateView,
    }),
    template: alert.message,
    view: templateView,
    team: {
      id: team._id.toString(),
    },
  });
};

export const roundDownTo = (roundTo: number) => (x: Date) =>
  new Date(Math.floor(x.getTime() / roundTo) * roundTo);
export const roundDownToXMinutes = (x: number) => roundDownTo(1000 * 60 * x);

export const processAlert = async (now: Date, alert: EnhancedAlert) => {
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
        alertId: alert.id,
      });
      return;
    }
    const checkStartTime = previous
      ? previous.createdAt
      : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins);
    const checkEndTime = nowInMinsRoundDown;

    let chartConfig: ChartConfigWithOptDateRange | undefined;
    let connectionId: string | undefined;
    let savedSearch: ISavedSearch | undefined | null;
    let dashboard: IDashboard | undefined | null;
    let source: ISource | undefined | null;
    // SAVED_SEARCH Source
    if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
      savedSearch = await SavedSearch.findById(alert.savedSearch);
      if (savedSearch == null) {
        logger.error({
          message: 'SavedSearch not found',
          alertId: alert.id,
        });
        return;
      }
      source = await Source.findById(savedSearch.source);
      if (source == null) {
        logger.error({
          message: 'Source not found',
          alertId: alert.id,
          savedSearch: alert.savedSearch,
        });
        return;
      }
      connectionId = source.connection.toString();
      chartConfig = {
        connection: connectionId,
        displayType: DisplayType.Line,
        dateRange: [checkStartTime, checkEndTime],
        from: source.from,
        granularity: `${windowSizeInMins} minute`,
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            valueExpression: '',
          },
        ],
        where: savedSearch.where,
        whereLanguage: savedSearch.whereLanguage,
        groupBy: alert.groupBy,
        implicitColumnExpression: source.implicitColumnExpression,
        timestampValueExpression: source.timestampValueExpression,
      };
    }
    // TILE Source
    else if (
      alert.source === AlertSource.TILE &&
      alert.dashboard &&
      alert.tileId
    ) {
      dashboard = await Dashboard.findById(alert.dashboard);
      if (dashboard == null) {
        logger.error({
          message: 'Dashboard not found',
          alertId: alert.id,
          dashboardId: alert.dashboard,
        });
        return;
      }
      // filter tiles
      dashboard.tiles = dashboard.tiles.filter(
        tile => tile.id === alert.tileId,
      );

      if (dashboard.tiles.length === 1) {
        // Doesn't work for metric alerts yet
        const MAX_NUM_GROUPS = 20;
        // TODO: assuming that the chart has only 1 series for now
        const firstTile = dashboard.tiles[0];
        if (firstTile.config.displayType === DisplayType.Line) {
          // fetch source data
          source = await Source.findById(firstTile.config.source);
          if (!source) {
            logger.error({
              message: 'Source not found',
              dashboardId: alert.dashboard,
              tile: firstTile,
            });
            return;
          }
          connectionId = source.connection.toString();
          chartConfig = {
            connection: connectionId,
            displayType: firstTile.config.displayType,
            dateRange: [checkStartTime, checkEndTime],
            from: source.from,
            granularity: `${windowSizeInMins} minute`,
            select: firstTile.config.select,
            where: firstTile.config.where,
            groupBy: firstTile.config.groupBy,
            implicitColumnExpression: source.implicitColumnExpression,
            timestampValueExpression: source.timestampValueExpression,
          };
        }
      }
    } else {
      logger.error({
        message: `Unsupported alert source: ${alert.source}`,
        alertId: alert.id,
      });
      return;
    }

    // Fetch data
    if (chartConfig == null || connectionId == null) {
      logger.error({
        message: 'Failed to build chart config',
        chartConfig,
        connectionId,
        alertId: alert.id,
      });
      return;
    }

    const connection = await getConnectionById(
      alert.team._id.toString(),
      connectionId,
      true,
    );

    if (connection == null) {
      logger.error({
        message: 'Connection not found',
        alertId: alert.id,
      });
      return;
    }
    const clickhouseClient = new clickhouse.ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
    const metadata = getMetadata(clickhouseClient);
    const query = await renderChartConfig(chartConfig, metadata);
    const checksData = await clickhouseClient
      .query<'JSON'>({
        query: query.sql,
        query_params: query.params,
        format: 'JSON',
      })
      .then(res => res.json<Record<string, string>>());

    logger.info({
      message: `Received alert metric [${alert.source} source]`,
      alertId: alert.id,
      checksData,
      checkStartTime,
      checkEndTime,
    });

    // TODO: support INSUFFICIENT_DATA state
    let alertState = AlertState.OK;
    const history = await new AlertHistory({
      alert: alert._id,
      createdAt: nowInMinsRoundDown,
      state: alertState,
    }).save();

    if (checksData?.rows && checksData?.rows > 0) {
      // attach JS type
      const meta =
        checksData.meta?.map(m => ({
          ...m,
          jsType: clickhouse.convertCHDataTypeToJSType(m.type),
        })) ?? [];

      const timestampColumnName = meta.find(
        m => m.jsType === clickhouse.JSDataType.Date,
      )?.name;
      const valueColumnNames = new Set(
        meta
          .filter(m => m.jsType === clickhouse.JSDataType.Number)
          .map(m => m.name),
      );

      if (timestampColumnName == null) {
        logger.error({
          message: 'Failed to find timestamp column',
          meta,
          alertId: alert.id,
        });
        return;
      }
      if (valueColumnNames.size === 0) {
        logger.error({
          message: 'Failed to find value column',
          meta,
          alertId: alert.id,
        });
        return;
      }

      for (const checkData of checksData.data) {
        let _value: number | null = null;
        const extraFields: string[] = [];
        // TODO: other keys should be attributes ? (for alert message template)
        for (const [k, v] of Object.entries(checkData)) {
          if (valueColumnNames.has(k)) {
            _value = isString(v) ? parseInt(v) : v;
          } else if (k !== timestampColumnName) {
            extraFields.push(`${k}:${v}`);
          }
        }

        // TODO: we might want to fix the null value from the upstream (check if this is still needed)
        // this happens when the ratio is 0/0
        if (_value == null) {
          continue;
        }
        const bucketStart = new Date(checkData[timestampColumnName]);
        if (doesExceedThreshold(alert.thresholdType, alert.threshold, _value)) {
          alertState = AlertState.ALERT;
          logger.info({
            message: `Triggering ${alert.channel.type} alarm!`,
            alertId: alert.id,
            totalCount: _value,
            checkData,
          });

          try {
            await fireChannelEvent({
              alert,
              attributes: {}, // FIXME: support attributes (logs + resources ?)
              clickhouseClient,
              dashboard,
              endTime: fns.addMinutes(bucketStart, windowSizeInMins),
              group: extraFields.join(', '),
              metadata,
              savedSearch,
              source,
              startTime: bucketStart,
              totalCount: _value,
              windowSizeInMins,
            });
          } catch (e) {
            logger.error({
              message: 'Failed to fire channel event',
              alertId: alert.id,
              error: serializeError(e),
            });
          }

          history.counts += 1;
        }
        history.lastValues.push({ count: _value, startTime: bucketStart });
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
      alertId: alert.id,
      error: serializeError(e),
    });
  }
};

export default async () => {
  const now = new Date();
  const alerts = await getAlerts();
  logger.info(`Going to process ${alerts.length} alerts`);
  await Promise.all(alerts.map(alert => processAlert(now, alert)));
};
