import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';

import { withRetry } from './retry';

// Bound the attempt so a hung Slack endpoint releases its socket rather than
// being abandoned in flight by the alert dispatcher's deadline. Mirrors the
// AbortSignal.timeout the generic webhook path uses, reading the same env var.
const getTimeoutMs = () => {
  const parsed = Number(process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
};

export function postMessageToWebhook(
  webhookUrl: string,
  message: IncomingWebhookSendArguments,
) {
  const webhook = new IncomingWebhook(webhookUrl, { timeout: getTimeoutMs() });
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
