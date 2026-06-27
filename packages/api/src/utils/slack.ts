import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';

import { withRetry } from './retry';

export function postMessageToWebhook(
  webhookUrl: string,
  message: IncomingWebhookSendArguments,
) {
  const webhook = new IncomingWebhook(webhookUrl);
  return withRetry(() =>
    webhook.send({
      text: message.text,
      blocks: message.blocks,
    }),
  );
}
