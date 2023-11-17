import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';

export function postMessageToWebhook(
  webhookUrl: string,
  message: IncomingWebhookSendArguments,
) {
  const webhook = new IncomingWebhook(webhookUrl);
  return webhook.send({
    text: message.text,
    blocks: message.blocks,
  });
}
