import { objectHash } from '@hyperdx/common-utils/dist/core/utils';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import Handlebars from 'handlebars';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { AlertState } from '@/models/alert';
import { IWebhook } from '@/models/webhook';
import { WebhookRedirectError } from '@/tasks/checkAlerts/errors';
import { PopulatedAlertChannel } from '@/tasks/checkAlerts/providers';
import { escapeJsonString } from '@/tasks/util';
import { getCounter, getHistogram } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { withRetry } from '@/utils/retry';
import * as slack from '@/utils/slack';
import {
  validateWebhookUrl,
  WebhookUrlValidationError,
} from '@/utils/validators';

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

const logBlockedWebhookDelivery = (error: unknown, webhook: IWebhook) => {
  if (error instanceof WebhookUrlValidationError) {
    logger.warn(
      {
        error: serializeError(error),
        webhook: {
          id: webhook._id.toString(),
          team: webhook.team.toString(),
        },
      },
      'Blocked alert webhook delivery',
    );
  }
};

// Fallback body for a generic/incidentio webhook persisted without one. Mirrors
// the default template the UI form applies (WebhookForm.tsx) so a webhook
// created via the API/MCP (where body is optional) still fires with a sensible
// payload instead of crashing Handlebars.compile on an undefined template.
const DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE =
  '{"text": "{{title}} | {{body}} | {{link}} | {{state}} | {{startTime}} | {{endTime}} | {{eventId}}"}';

/**
 * Creates a Handlebars instance with common helpers registered.
 * Use this to ensure consistent helper availability across all template rendering.
 */
export const createHandlebarsWithHelpers = () => {
  const hb = Handlebars.create();
  // Register eq helper for conditional checks (e.g., {{#if (eq state "ALERT")}})
  hb.registerHelper('eq', (a, b) => a === b);
  return hb;
};

export interface Message {
  hdxLink: string;
  title: string;
  body: string;
  state: AlertState;
  startTime: number;
  endTime: number;
  eventId: string;
}

export const notifyChannel = async ({
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
    logBlockedWebhookDelivery(e, webhook);
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
    logBlockedWebhookDelivery(e, webhook);
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

    // Handlebars.compile throws on undefined; the API/MCP create paths allow an
    // absent body (the UI form applies the default). An explicit "" is honored.
    const bodyTemplate =
      webhook.body == null
        ? DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE
        : webhook.body;

    body = handlebars.compile(bodyTemplate, {
      noEscape: true,
    })({
      body: escapeJsonString(message.body),
      endTime: message.endTime,
      eventId: message.eventId,
      link: escapeJsonString(message.hdxLink),
      startTime: message.startTime,
      state: message.state,
      title: escapeJsonString(message.title),
    });
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
    await withRetry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: headers as Record<string, string>,
        body,
      });

      // Disallow redirects to avoid redirect-based SSRF.
      if (res.status >= 300 && res.status < 400) {
        logger.error(
          { webhookId: webhook._id.toString(), teamId: webhook.team },
          'Webhook request was redirected, which is not allowed',
        );
        throw new WebhookRedirectError(res.status);
      }

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
