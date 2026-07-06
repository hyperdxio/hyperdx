import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';

import { withRetry } from './retry';

export function postMessageToWebhook(
  webhookUrl: string,
  message: IncomingWebhookSendArguments,
) {
  const webhook = new IncomingWebhook(webhookUrl);
  // Note: We only retry on 429 (Rate Limited) for Slack Incoming Webhooks.
  // Retrying ambiguous 5xx/timeouts causes duplicate alerts due to lack of idempotency keys.
  return withRetry(
    () =>
      webhook.send({
        text: message.text,
        blocks: message.blocks,
      }),
    { retryOnlyOnStatus: [429] },
  );
}
