import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  _useTry,
  formatDate,
  objectHash,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  AlertChannelType,
  AlertThresholdType,
  ChartConfigWithOptDateRange,
  DisplayType,
  isRangeThresholdType,
  pickSampleWeightExpressionProps,
  SourceKind,
  WebhookService,
  zAlertChannelType,
} from '@hyperdx/common-utils/dist/types';
import { isValidSlackUrl } from '@hyperdx/common-utils/dist/validation';
import Handlebars, { HelperOptions } from 'handlebars';
import _ from 'lodash';
import mongoose from 'mongoose';
import { performance } from 'perf_hooks';
import PromisedHandlebars from 'promised-handlebars';
import { serializeError } from 'serialize-error';
import { z } from 'zod';

import * as config from '@/config';
import { AlertInput } from '@/controllers/alerts';
import { AlertSource, AlertState } from '@/models/alert';
import { IDashboard } from '@/models/dashboard';
import { ISavedSearch } from '@/models/savedSearch';
import { ISource } from '@/models/source';
import { IWebhook } from '@/models/webhook';
import { startAgentSession } from '@/services/anthropicAgents';
import {
  computeAliasWithClauses,
  doesExceedThreshold,
} from '@/tasks/checkAlerts';
import {
  AlertProvider,
  PopulatedAlertChannel,
} from '@/tasks/checkAlerts/providers';
import { escapeJsonString, unflattenObject } from '@/tasks/util';
import { truncateString } from '@/utils/common';
import { getCounter, getHistogram } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { withRetry } from '@/utils/retry';
import * as slack from '@/utils/slack';

// Webhook delivery is the last (and most failure-prone) hop of an alert. It
// happens in the background task, so failures only show up in logs today.
// `service` and `outcome` are bounded enums (see agent_docs/observability.md).
const webhookDeliveryCounter = getCounter('hyperdx.alerts.webhook_deliveries', {
  description:
    'Count of alert webhook delivery attempts, labeled by service (slack, generic, incidentio) and outcome (success, error).',
});
const webhookDeliveryDuration = getHistogram(
  'hyperdx.alerts.webhook_delivery.duration_ms',
  {
    description:
      'Duration of an alert webhook delivery attempt, labeled by service.',
    unit: 'ms',
  },
);

const describeThresholdViolation = (
  thresholdType: AlertThresholdType,
): string => {
  switch (thresholdType) {
    case AlertThresholdType.ABOVE:
      return 'meets or exceeds';
    case AlertThresholdType.ABOVE_EXCLUSIVE:
      return 'exceeds';
    case AlertThresholdType.BELOW:
      return 'falls below';
    case AlertThresholdType.BELOW_OR_EQUAL:
      return 'falls to or below';
    case AlertThresholdType.EQUAL:
      return 'equals';
    case AlertThresholdType.NOT_EQUAL:
      return 'does not equal';
    case AlertThresholdType.BETWEEN:
      return 'falls between';
    case AlertThresholdType.NOT_BETWEEN:
      return 'falls outside';
  }
};

const describeThresholdResolution = (
  thresholdType: AlertThresholdType,
): string => {
  switch (thresholdType) {
    case AlertThresholdType.ABOVE:
      return 'falls below';
    case AlertThresholdType.ABOVE_EXCLUSIVE:
      return 'falls to or below';
    case AlertThresholdType.BELOW:
      return 'meets or exceeds';
    case AlertThresholdType.BELOW_OR_EQUAL:
      return 'exceeds';
    case AlertThresholdType.EQUAL:
      return 'does not equal';
    case AlertThresholdType.NOT_EQUAL:
      return 'equals';
    case AlertThresholdType.BETWEEN:
      return 'falls outside';
    case AlertThresholdType.NOT_BETWEEN:
      return 'falls between';
  }
};

const describeThreshold = (alert: AlertInput): string => {
  return isRangeThresholdType(alert.thresholdType)
    ? `${alert.threshold} and ${alert.thresholdMax ?? '?'}`
    : `${alert.threshold}`;
};

// Enriched webhook payload mappings (e.g. Claude Managed Agents). These turn
// internal enums into the stable, agent-friendly strings documented in the
// webhook contract.
const ALERT_STATUS_BY_STATE: Record<AlertState, string> = {
  [AlertState.ALERT]: 'firing',
  [AlertState.OK]: 'resolved',
  [AlertState.INSUFFICIENT_DATA]: 'no_data',
  [AlertState.DISABLED]: 'no_data',
  [AlertState.PENDING]: 'pending',
};

const COMPARATOR_BY_THRESHOLD_TYPE: Record<AlertThresholdType, string> = {
  [AlertThresholdType.ABOVE]: '>=',
  [AlertThresholdType.ABOVE_EXCLUSIVE]: '>',
  [AlertThresholdType.BELOW]: '<',
  [AlertThresholdType.BELOW_OR_EQUAL]: '<=',
  [AlertThresholdType.EQUAL]: '=',
  [AlertThresholdType.NOT_EQUAL]: '!=',
  [AlertThresholdType.BETWEEN]: 'between',
  [AlertThresholdType.NOT_BETWEEN]: 'outside',
};

const ALERT_TYPE_BY_SOURCE: Record<AlertSource, string> = {
  [AlertSource.SAVED_SEARCH]: 'search',
  [AlertSource.TILE]: 'dashboard_chart',
};

const MAX_MESSAGE_LENGTH = 500;
const NOTIFY_FN_NAME = '__hdx_notify_channel__';
const IS_MATCH_FN_NAME = 'is_match';

/**
 * Creates a Handlebars instance with common helpers registered.
 * Use this to ensure consistent helper availability across all template rendering.
 */
const createHandlebarsWithHelpers = () => {
  const hb = Handlebars.create();
  // Register eq helper for conditional checks (e.g., {{#if (eq state "ALERT")}})
  hb.registerHelper('eq', (a, b) => a === b);
  return hb;
};

const zNotifyFnParams = z.object({
  hash: z.object({
    channel: zAlertChannelType,
    id: z.string(),
  }),
});

// should match the external alert schema
export type AlertMessageTemplateDefaultView = {
  alert: AlertInput;
  attributes: ReturnType<typeof unflattenObject>;
  dashboard?: IDashboard | null;
  endTime: Date;
  granularity: string;
  group?: string;
  isGroupedAlert: boolean;
  savedSearch?: ISavedSearch | null;
  source?: ISource | null;
  startTime: Date;
  value: number;
};

interface Message {
  hdxLink: string;
  title: string;
  body: string;
  state: AlertState;
  startTime: number;
  endTime: number;
  eventId: string;
  // Enriched fields for agent-ready payloads (Claude Managed Agents, etc).
  // Optional so existing callers/tests and non-enriched templates are unaffected.
  alertId?: string;
  status?: string; // firing | resolved | no_data
  alertType?: string; // search | dashboard_chart
  comparator?: string; // >=, >, <=, <, =, !=, between, outside
  threshold?: number;
  value?: number; // the value that triggered/resolved the alert
  groupKey?: string;
  sourceQuery?: string; // the search expr / SQL that defines the alert
  teamId?: string;
  note?: string; // freeform alert note (markdown); commonly holds a runbook link
}

export const isAlertResolved = (state?: AlertState): boolean => {
  return state === AlertState.OK;
};

/**
 * Formats the value to match the decimal precision of the threshold.
 * This ensures consistent display of numbers in alert messages.
 * Uses Intl.NumberFormat for better precision handling with large numbers.
 */
export const formatValueToMatchThreshold = (
  value: number,
  threshold: number,
): string => {
  // Format threshold with NumberFormat to get its string representation
  const thresholdFormatted = new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 21,
    useGrouping: false,
  }).format(threshold);

  // Count decimal places in the formatted threshold
  const decimalIndex = thresholdFormatted.indexOf('.');
  const decimalPlaces =
    decimalIndex === -1 ? 0 : thresholdFormatted.length - decimalIndex - 1;

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
    useGrouping: false,
  }).format(value);
};

const notifyChannel = async ({
  channel,
  message,
}: {
  channel: PopulatedAlertChannel;
  message: Message;
}) => {
  switch (channel.type) {
    case 'webhook': {
      const webhook = channel.channel;
      // TODO: migrate to use handleSendGenericWebhook so templates can be used
      if (webhook.service === WebhookService.Slack) {
        await handleSendSlackWebhook(webhook, message);
      } else if (webhook.service === WebhookService.Claude) {
        // First-class agent action: start a managed-agent session in-process
        // rather than POSTing the payload to an external receiver.
        await handleStartAgentSession(webhook, message);
      } else if (
        webhook.service === WebhookService.Generic ||
        webhook.service === WebhookService.IncidentIO
      ) {
        await handleSendGenericWebhook(webhook, message);
      }
      break;
    }
    default:
      throw new Error(`Unsupported channel type: ${channel.type}`);
  }
};

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
    if (!isValidSlackUrl(webhook.url)) {
      const message = `Slack Webhook URL ${webhook.url} does not have hostname that ends in 'slack.com'`;
      logger.warn(
        {
          webhook: {
            id: webhook._id.toString(),
            name: webhook.name,
            url: webhook.url,
            body: webhook.body,
          },
        },
        message,
      );
      throw new Error(`SSRF AllowedDomainError: ${message}`);
    }
  } else {
    // check webhookurl host is not blacklisted
    const url = new URL(webhook.url);
    if (blacklistedWebhookHosts.has(url.host)) {
      const message = `Webhook attempting to query blacklisted route ${blacklistedWebhookHosts.get(
        url.host,
      )}`;
      logger.warn(
        {
          webhook: {
            id: webhook._id.toString(),
            name: webhook.name,
            url: webhook.url,
            body: webhook.body,
          },
        },
        message,
      );
      throw new Error(`SSRF AllowedDomainError: ${message}`);
    }
  }
}

export const handleSendSlackWebhook = async (
  webhook: IWebhook,
  message: Message,
) => {
  const startedAt = performance.now();
  try {
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
    webhookDeliveryCounter.add(1, {
      service: WebhookService.Slack,
      outcome: 'success',
    });
  } catch (e) {
    webhookDeliveryCounter.add(1, {
      service: WebhookService.Slack,
      outcome: 'error',
    });
    throw e;
  } finally {
    webhookDeliveryDuration.record(performance.now() - startedAt, {
      service: WebhookService.Slack,
    });
  }
};

// Builds the agent-ready payload for the firing alert, serialized as the
// session's user message. This is the enriched, structured JSON format (the same
// schema the Claude webhook body documented) — the agent gets complete,
// unambiguous context (condition + source_query + time_range) it can act on
// without a round-trip, and it stays easy to extend with new fields. The
// embedded `prompt` is the per-invocation instruction; the agent's standing
// instructions live in its system prompt (see anthropicAgents).
// The variable set exposed to user-editable webhook body templates (Generic,
// IncidentIO, and the Claude kickoff prompt). Strings are JSON-escaped;
// numbers are emitted raw for unquoted JSON slots.
const buildWebhookTemplateVariables = (message: Message) => ({
  body: escapeJsonString(message.body),
  endTime: message.endTime,
  eventId: message.eventId,
  link: escapeJsonString(message.hdxLink),
  startTime: message.startTime,
  state: message.state,
  title: escapeJsonString(message.title),
  alertId: escapeJsonString(message.alertId ?? ''),
  alertType: escapeJsonString(message.alertType ?? ''),
  comparator: escapeJsonString(message.comparator ?? ''),
  groupKey: escapeJsonString(message.groupKey ?? ''),
  note: escapeJsonString(message.note ?? ''),
  sourceQuery: escapeJsonString(message.sourceQuery ?? ''),
  status: escapeJsonString(message.status ?? ''),
  teamId: escapeJsonString(message.teamId ?? ''),
  threshold: message.threshold,
  value: message.value,
});

// Compiles the Claude webhook's user-editable Handlebars body into the agent
// kickoff prompt, using the same variables the Generic path exposes.
// Fail-open: an empty or uncompilable body returns null and the caller falls
// back to the built-in enriched payload — a broken template must not stop an
// investigation (unlike the Generic path, where the body IS the delivery and
// failing loudly is correct). Exercised via handleStartAgentSession in tests.
const compileClaudeWebhookBody = (
  webhook: IWebhook,
  message: Message,
): string | null => {
  if (!webhook.body?.trim()) return null;
  try {
    const handlebars = createHandlebarsWithHelpers();
    const compiled = handlebars.compile(webhook.body, { noEscape: true })(
      buildWebhookTemplateVariables(message),
    );
    // A body that renders blank (e.g. every variable resolved empty) must fall
    // back too — `??` only catches null, so return null rather than starting an
    // investigation with an empty kickoff message.
    return compiled.trim() ? compiled : null;
  } catch (e) {
    logger.warn(
      { error: serializeError(e) },
      'Failed to compile Claude webhook body; using the built-in agent prompt',
    );
    return null;
  }
};

export const buildAgentPrompt = (message: Message): string => {
  const payload = {
    source: 'clickstack',
    schema_version: '1',
    prompt:
      'A ClickStack alert fired. Investigate the root cause using your pre-configured clickstack MCP server (logs, traces, metrics, and alert history). Reconstruct and re-run the alert source_query over the time_range, inspect related logs, traces, and metrics, follow context.runbook if present, check recent deploys, then post a concise, evidence-linked root-cause summary.',
    alert: {
      id: message.alertId,
      event_id: message.eventId,
      status: message.status,
      type: message.alertType,
      title: message.title,
      body: message.body,
      link: message.hdxLink,
    },
    condition: {
      comparator: message.comparator,
      threshold: message.threshold,
      current_value: message.value,
    },
    context: {
      group_key: message.groupKey,
      source_query: message.sourceQuery,
      runbook: message.note,
      team_id: message.teamId,
      time_range: {
        start: new Date(message.startTime).toISOString(),
        end: new Date(message.endTime).toISOString(),
      },
    },
  };
  return JSON.stringify(payload, null, 2);
};

// Claude managed-agent dispatch. Mirrors the other handle* senders (timed,
// counted) but instead of an HTTP POST it starts an in-process agent session.
// The webhook's `url` field is reused as the Slack URL the result is delivered
// to once the session idles.
export const handleStartAgentSession = async (
  webhook: IWebhook,
  message: Message,
) => {
  const startedAt = performance.now();
  try {
    // Only investigate on the firing edge. notifyChannel also runs on resolve
    // (status resolved/no_data); the agent prompt is "an alert fired —
    // investigate", so starting a session on resolution is wrong and wasteful.
    if (message.status && message.status !== 'firing') {
      return;
    }
    if (!message.teamId) {
      throw new Error(
        'Cannot start agent session: alert message has no teamId',
      );
    }
    if (!webhook.url) {
      throw new Error(
        'Claude agent webhook requires a Slack delivery URL in its url field',
      );
    }
    await startAgentSession({
      teamId: new mongoose.Types.ObjectId(message.teamId),
      alertId: message.alertId,
      eventId: message.eventId,
      title: message.title,
      // The webhook's user-editable body template is the kickoff prompt;
      // the built-in enriched payload is the fail-open fallback.
      prompt:
        compileClaudeWebhookBody(webhook, message) ?? buildAgentPrompt(message),
      deliverToUrl: webhook.url,
    });
    webhookDeliveryCounter.add(1, {
      service: WebhookService.Claude,
      outcome: 'success',
    });
  } catch (e) {
    webhookDeliveryCounter.add(1, {
      service: WebhookService.Claude,
      outcome: 'error',
    });
    throw e;
  } finally {
    webhookDeliveryDuration.record(performance.now() - startedAt, {
      service: WebhookService.Claude,
    });
  }
};

export const handleSendGenericWebhook = async (
  webhook: IWebhook,
  message: Message,
) => {
  const startedAt = performance.now();
  // webhook.service is an enum, so it is safe as a low-cardinality label.
  const service = webhook.service ?? WebhookService.Generic;
  try {
    await sendGenericWebhook(webhook, message);
    webhookDeliveryCounter.add(1, { service, outcome: 'success' });
  } catch (e) {
    webhookDeliveryCounter.add(1, { service, outcome: 'error' });
    throw e;
  } finally {
    webhookDeliveryDuration.record(performance.now() - startedAt, { service });
  }
};

const sendGenericWebhook = async (webhook: IWebhook, message: Message) => {
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
    // Stable per-alert key for receivers that honour Idempotency-Key; delivery is at-least-once.
    'Idempotency-Key': objectHash({
      eventId: message.eventId,
      startTime: message.startTime,
      endTime: message.endTime,
      state: message.state,
    }),
  };
  // BODY
  let body = '';
  try {
    const handlebars = createHandlebarsWithHelpers();

    body = handlebars.compile(webhook.body, {
      noEscape: true,
    })(buildWebhookTemplateVariables(message));
  } catch (e) {
    logger.error(
      {
        error: serializeError(e),
      },
      'Failed to compile generic webhook body',
    );
    throw new Error('Failed to build webhook request body', { cause: e });
  }

  try {
    const response = await withRetry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: headers as Record<string, string>,
        body,
      });

      if (!res.ok) {
        const errorText = await res.text();
        const err = new Error(errorText) as any;
        err.status = res.status;
        throw err;
      }

      return res;
    });
  } catch (e) {
    logger.error(
      {
        error: serializeError(e),
      },
      'Failed to send generic webhook message',
    );
    // rethrow so that it can be recorded in alert errors
    throw e;
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
      tileId: alert.tileId,
    });
  }

  throw new Error(`Unsupported alert source: ${(alert as any).source}`);
};

export const buildAlertMessageTemplateTitle = ({
  template,
  view,
  state,
}: {
  template?: string | null;
  view: AlertMessageTemplateDefaultView;
  state?: AlertState;
}) => {
  const { alert, dashboard, savedSearch, value } = view;
  const handlebars = createHandlebarsWithHelpers();

  // Add emoji prefix based on alert state
  const emoji = isAlertResolved(state) ? '✅ ' : '🚨 ';

  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source}  but savedSearch is null`);
    }
    // TODO: using template engine to render the title
    const baseTitle = template
      ? handlebars.compile(template)(view)
      : `Alert for "${savedSearch.name}" - ${value} lines found`;
    return `${emoji}${baseTitle}`;
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    const tile = dashboard.tiles.find(t => t.id === alert.tileId);
    if (!tile) {
      throw new Error(
        `Tile with id ${alert.tileId} not found in dashboard ${dashboard.name}`,
      );
    }
    const formattedValue = formatValueToMatchThreshold(value, alert.threshold);
    const baseTitle = template
      ? handlebars.compile(template)(view)
      : `Alert for "${tile.config.name}" in "${dashboard.name}" - ${formattedValue} ${
          doesExceedThreshold(alert, value)
            ? describeThresholdViolation(alert.thresholdType)
            : describeThresholdResolution(alert.thresholdType)
        } ${describeThreshold(alert)}`;
    return `${emoji}${baseTitle}`;
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

const findWebhookByName = (
  channelIdOrNamePrefix: string,
  teamWebhooksById: Map<string, IWebhook>,
) => {
  return [...teamWebhooksById.values()].find(w =>
    w.name.startsWith(channelIdOrNamePrefix),
  );
};

const getPopulatedChannel = (
  channelType: AlertChannelType,
  channelIdOrNamePrefix: string,
  teamWebhooksById: Map<string, IWebhook>,
): PopulatedAlertChannel => {
  switch (channelType) {
    case 'webhook': {
      const webhook =
        teamWebhooksById.get(channelIdOrNamePrefix) ??
        findWebhookByName(channelIdOrNamePrefix, teamWebhooksById);

      if (!webhook) {
        logger.error(
          {
            webhookId: channelIdOrNamePrefix,
          },
          'webhook not found',
        );
        throw new Error(
          `Webhook not found. The webhook may have been deleted — update the alert's notification channel.`,
        );
      }
      return { type: 'webhook', channel: webhook };
    }
    default: {
      logger.error({ channelType }, 'Unsupported alert channel type');
      throw new Error('Unsupported alert destination');
    }
  }
};

// this method will build the body of the alert message and will be used to send the alert to the channel
export const renderAlertTemplate = async ({
  alertProvider,
  clickhouseClient,
  metadata,
  state,
  template,
  title,
  view: inputView,
  teamWebhooksById,
}: {
  alertProvider: AlertProvider;
  clickhouseClient: ClickhouseClient;
  metadata: Metadata;
  state: AlertState;
  template?: string | null;
  title: string;
  view: AlertMessageTemplateDefaultView;
  teamWebhooksById: Map<string, IWebhook>;
}) => {
  // Internal mutable view with __hdx_query_results__ populated on the
  // saved-search path. Untrusted values must flow through the view so
  // Handlebars treats them as literal data, never as template syntax.
  const view: AlertMessageTemplateDefaultView & {
    __hdx_query_results__: string;
  } = {
    ...inputView,
    __hdx_query_results__: '',
  };

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
  const _hb = createHandlebarsWithHelpers();
  _hb.registerHelper(NOTIFY_FN_NAME, () => null);
  _hb.registerHelper(IS_MATCH_FN_NAME, isMatchFn(true));
  const hb = PromisedHandlebars(Handlebars);
  const registerHelpers = (rawTemplateBody: string) => {
    hb.registerHelper(IS_MATCH_FN_NAME, isMatchFn(false));

    // Register a custom helper which sends notifications to the specified channel
    // Usage: {{NOTIFY_FN_NAME channel="webhook" id="1234_5678"}}
    hb.registerHelper(NOTIFY_FN_NAME, async (options: unknown) => {
      const { hash } = zNotifyFnParams.parse(options);
      const { channel: channelType, id: idTemplate } = hash;

      // The id field can also be a template itself, e.g. id="{{attributes.webhookId}}", so it must be compiled and rendered
      // The id might also be the prefix of the webhook name.
      const renderedIdOrNamePrefix = _hb.compile(idTemplate)(view);

      // render body template
      const renderedBody = _hb.compile(rawTemplateBody)(view);

      const channel = getPopulatedChannel(
        channelType,
        renderedIdOrNamePrefix,
        teamWebhooksById,
      );

      if (channel) {
        const startTime = view.startTime.getTime();
        const endTime = view.endTime.getTime();

        const eventId = objectHash({
          alertId: alert.id,
          channel: {
            type: channel.type,
            id: channel.channel._id.toString(),
          },
          // Explicitly track if this is a grouped alert
          isGrouped: view.isGroupedAlert,
          ...(view.isGroupedAlert && group ? { groupId: group } : {}),
        });

        await notifyChannel({
          channel,
          message: {
            hdxLink: buildAlertMessageTemplateHdxLink(alertProvider, view),
            title,
            body: renderedBody,
            state,
            startTime,
            endTime,
            eventId,
            // Enriched fields for agent-ready payloads (Claude, etc).
            alertId: alert.id ?? '',
            status: ALERT_STATUS_BY_STATE[state],
            alertType: alert.source ? ALERT_TYPE_BY_SOURCE[alert.source] : '',
            comparator: COMPARATOR_BY_THRESHOLD_TYPE[alert.thresholdType],
            threshold: alert.threshold,
            value,
            groupKey: group ?? '',
            sourceQuery: savedSearch?.where ?? '',
            teamId: (source?.team ?? dashboard?.team)?.toString() ?? '',
            note: alert.note ?? '',
          },
        });
      }
    });
  };

  const timeRangeMessage = `Time Range (UTC): [${formatDate(view.startTime, {
    isUTC: true,
  })} - ${formatDate(view.endTime, {
    isUTC: true,
  })})`;
  let rawTemplateBody;

  // For resolved alerts, use a simple message instead of fetching data
  if (isAlertResolved(state)) {
    rawTemplateBody = `{{#if group}}Group: "{{{group}}}" - {{/if}}The alert has been resolved.\n${timeRangeMessage}
${targetTemplate}`;
  }
  // TODO: support advanced routing with template engine
  // users should be able to use '@' syntax to trigger alerts
  else if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source} but savedSearch is null`);
    }
    if (source == null) {
      throw new Error(`Source ID is ${alert.source} but source is null`);
    }
    if (source.kind !== SourceKind.Log && source.kind !== SourceKind.Trace) {
      throw new Error(
        `Expecting SourceKind 'trace' or 'log', got ${source.kind}`,
      );
    }
    // TODO: show group + total count for group-by alerts
    // fetch sample logs
    const resolvedSelect =
      savedSearch.select || source.defaultTableSelectExpression || '';
    const chartConfig: ChartConfigWithOptDateRange = {
      connection: '', // no need for the connection id since clickhouse client is already initialized
      displayType: DisplayType.Search,
      dateRange: [startTime, endTime],
      from: source.from,
      select: resolvedSelect,
      where: savedSearch.where,
      whereLanguage: savedSearch.whereLanguage,
      implicitColumnExpression: source.implicitColumnExpression,
      useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
      ...pickSampleWeightExpressionProps(source),
      timestampValueExpression: source.timestampValueExpression,
      orderBy: savedSearch.orderBy,
      limit: {
        limit: 5,
        offset: 0,
      },
    };

    let truncatedResults = '';
    try {
      const aliasWith = await computeAliasWithClauses(
        savedSearch,
        source,
        metadata,
      );
      if (aliasWith) {
        chartConfig.with = aliasWith;
      }
      const query = await renderChartConfig(
        chartConfig,
        metadata,
        source.querySettings,
      );
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
      logger.error(
        {
          savedSearchId: savedSearch.id,
          chartConfig,
          error: serializeError(e),
        },
        'Failed to fetch sample logs',
      );
    }

    // Pass query results through the view so Handlebars syntax in log lines
    // is treated as literal text rather than parsed as template source.
    view.__hdx_query_results__ = truncatedResults;

    rawTemplateBody = `{{#if group}}Group: "{{{group}}}"{{/if}}
${value} lines found, which ${describeThresholdViolation(alert.thresholdType)} the threshold of ${describeThreshold(alert)} lines\n${timeRangeMessage}
${targetTemplate}
\`\`\`
{{{__hdx_query_results__}}}
\`\`\``;
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    const formattedValue = formatValueToMatchThreshold(value, alert.threshold);
    rawTemplateBody = `{{#if group}}Group: "{{{group}}}"{{/if}}
${formattedValue} ${
      doesExceedThreshold(alert, value)
        ? describeThresholdViolation(alert.thresholdType)
        : describeThresholdResolution(alert.thresholdType)
    } ${describeThreshold(alert)}\n${timeRangeMessage}
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
