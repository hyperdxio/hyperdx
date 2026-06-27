import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';

import { withRetry } from './retry';

export function postMessageToWebhook(
  webhookUrl: string,
  message: IncomingWebhookSendArguments,
) {
  const webhook = new IncomingWebhook(webhookUrl);
  // Note: We deliberately restrict Slack Incoming Webhooks to only retry on 429
  // (Too Many Requests). Incoming Webhooks do not support Idempotency Keys.
  // Retrying ambiguous failures (like a client-side timeout after the server
  // already accepted the payload) would result in duplicate alert messages.
  // A 429 response is an explicit rejection, making it 100% safe to retry.
  return withRetry(
    () =>
      webhook.send({
        text: message.text,
        blocks: message.blocks,
      }),
    { retryOnlyOnStatus: [429] },
  );
}
