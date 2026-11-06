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

const MAX_SLACK_SECTION_LENGTH = 3000;

export const getFallbackHdxLink = (hdxLink: string): string => {
  try {
    const url = new URL(hdxLink);
    return `${url.origin}/alerts`;
  } catch {
    return hdxLink;
  }
};

export const formatSlackSectionText = (
  hdxLink: string,
  title: string,
  body: string,
  maxLength = MAX_SLACK_SECTION_LENGTH,
): string => {
  let link = hdxLink;
  let text = `*<${link} | ${title}>*\n${body}`;
  if (text.length <= maxLength) {
    return text;
  }

  // If text exceeds limit, try falling back to the shorter /alerts link
  const fallbackLink = getFallbackHdxLink(hdxLink);
  if (fallbackLink !== link) {
    text = `*<${fallbackLink} | ${title}>*\n${body}`;
    if (text.length <= maxLength) {
      return text;
    }
    link = fallbackLink;
  }

  // If still exceeding limit, truncate body with an ellipsis
  const header = `*<${link} | ${title}>*\n`;
  const availableBodyLen = maxLength - header.length - 3;
  if (availableBodyLen > 0) {
    return `${header}${body.slice(0, availableBodyLen)}...`;
  }

  return `*<${link} | ${title}>*`.slice(0, maxLength);
};

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
            text: formatSlackSectionText(
              message.hdxLink,
              message.title,
              message.body,
            ),
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
