import * as clickhouse from '@hyperdx/common-utils/dist/clickhouse';
import { Metadata } from '@hyperdx/common-utils/dist/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { _useTry, formatDate } from '@hyperdx/common-utils/dist/utils';
import Handlebars, { HelperOptions } from 'handlebars';
import _ from 'lodash';
import { escapeRegExp } from 'lodash';
import mongoose from 'mongoose';
import PromisedHandlebars from 'promised-handlebars';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { AlertInput } from '@/controllers/alerts';
import { AlertSource, AlertThresholdType } from '@/models/alert';
import { IDashboard } from '@/models/dashboard';
import { ISavedSearch } from '@/models/savedSearch';
import { ISource } from '@/models/source';
import { IWebhook } from '@/models/webhook';
import Webhook from '@/models/webhook';
import { doesExceedThreshold } from '@/tasks/checkAlerts';
import { AlertProvider } from '@/tasks/providers';
import { escapeJsonString, unflattenObject } from '@/tasks/util';
import { truncateString } from '@/utils/common';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';

const MAX_MESSAGE_LENGTH = 500;
const NOTIFY_FN_NAME = '__hdx_notify_channel__';
const IS_MATCH_FN_NAME = 'is_match';

// should match the external alert schema
export type AlertMessageTemplateDefaultView = {
  alert: AlertInput;
  attributes: ReturnType<typeof unflattenObject>;
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

      if (webhook?.service === WebhookService.Slack) {
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

function extractDomainFromUrl(url: string): string {
  const hostname = new URL(url).hostname;
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

const blacklistedWebhookHosts = (() => {
  const map = new Map<string, string>();
  const configKeys = ['CLICKHOUSE_HOST', 'MONGO_URI'];
  for (const configKey of configKeys) {
    // ignore errors
    const [_, e] = _useTry(() =>
      map.set(new URL(config[configKey]).host, configKey),
    );
  }
  return map;
})();

function validateWebhookUrl(
  webhook: IWebhook,
): asserts webhook is IWebhook & { url: string } {
  if (!webhook.url) {
    throw new Error('Webhook URL is not set');
  }

  if (webhook.service === WebhookService.Slack) {
    // check that hostname ends in "slack.com"
    if (extractDomainFromUrl(webhook.url) !== 'slack.com') {
      const message = `Slack Webhook URL ${webhook.url} does not have hostname that ends in 'slack.com'`;
      logger.warn({
        webhook: {
          id: webhook._id.toString(),
          name: webhook.name,
          url: webhook.url,
          body: webhook.body,
        },
        message,
      });
      throw new Error(`SSRF AllowedDomainError: ${message}`);
    }
  } else {
    // check webhookurl host is not blacklisted
    const url = new URL(webhook.url);
    if (blacklistedWebhookHosts.has(url.host)) {
      const message = `Webhook attempting to query blacklisted route ${blacklistedWebhookHosts.get(
        url.host,
      )}`;
      logger.warn({
        webhook: {
          id: webhook._id.toString(),
          name: webhook.name,
          url: webhook.url,
          body: webhook.body,
        },
        message,
      });
      throw new Error(`SSRF AllowedDomainError: ${message}`);
    }
  }
}

export const handleSendSlackWebhook = async (
  webhook: IWebhook,
  message: {
    hdxLink: string;
    title: string;
    body: string;
  },
) => {
  validateWebhookUrl(webhook);

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
  validateWebhookUrl(webhook);

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
    const handlebars = Handlebars.create();
    body = handlebars.compile(webhook.body, {
      noEscape: true,
    })({
      body: escapeJsonString(message.body),
      link: escapeJsonString(message.hdxLink),
      title: escapeJsonString(message.title),
    });
  } catch (e) {
    logger.error({
      message: 'Failed to compile generic webhook body',
      error: serializeError(e),
    });
    return;
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

export const buildAlertMessageTemplateHdxLink = (
  alertProvider: AlertProvider,
  {
    alert,
    dashboard,
    endTime,
    granularity,
    savedSearch,
    startTime,
  }: AlertMessageTemplateDefaultView,
) => {
  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source} but savedSearch is null`);
    }
    return alertProvider.buildLogSearchLink({
      endTime,
      savedSearch,
      startTime,
    });
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    return alertProvider.buildChartLink({
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
  alertProvider,
  clickhouseClient,
  metadata,
  template,
  title,
  view,
  team,
}: {
  alertProvider: AlertProvider;
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
            hdxLink: buildAlertMessageTemplateHdxLink(alertProvider, view),
            title,
            body: renderedBody,
          },
          team,
        });
      },
    );
  };

  const timeRangeMessage = `Time Range (UTC): [${formatDate(view.startTime, {
    isUTC: true,
  })} - ${formatDate(view.endTime, {
    isUTC: true,
  })})`;
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
      select: savedSearch.select || source.defaultTableSelectExpression || '', // remove alert body if there is no select and defaultTableSelectExpression
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
    } ${alert.threshold} lines\n${timeRangeMessage}
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
    } ${alert.threshold}\n${timeRangeMessage}
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
