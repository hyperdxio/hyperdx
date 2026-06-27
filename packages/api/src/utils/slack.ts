import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';

export function postMessageToWebhook(
  webhookUrl: string,
  message: IncomingWebhookSendArguments,
) {
  const webhook = new IncomingWebhook(webhookUrl);
  // Note: exclude Slack Incoming Webhooks from our `withRetry` 
  // mechanism. Unlike custom webhooks or the Slack Web API, Incoming Webhooks 
  // do not support Idempotency Keys. Retrying ambiguous failures (like a client-side 
  // timeout after the server already accepted the payload) would result in duplicate 
  // alert messages spamming user channels.
  return webhook.send({
    text: message.text,
    blocks: message.blocks,
  });
}
