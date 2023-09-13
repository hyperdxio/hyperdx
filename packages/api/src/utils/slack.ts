import _ from 'lodash';
import { IncomingWebhook } from '@slack/webhook';

export function postMessageToWebhook(webhookUrl: string, message: any) {
  const webhook = new IncomingWebhook(webhookUrl);
  return webhook.send({
    text: message.text,
    blocks: message.blocks,
  });
}
