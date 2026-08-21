import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { performance } from 'perf_hooks';

import {
  logBlockedWebhookDelivery,
  webhookDeliveryCounter,
  webhookDeliveryDuration,
} from '@/tasks/checkAlerts/transports/generic';
import type {
  Message,
  WebhookChannel,
} from '@/tasks/checkAlerts/transports/types';
import * as slack from '@/utils/slack';
import { validateWebhookUrl } from '@/utils/validators';

export const handleSendSlackWebhook = async (
  channel: WebhookChannel,
  message: Message,
) => {
  const webhook = channel.channel;
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
