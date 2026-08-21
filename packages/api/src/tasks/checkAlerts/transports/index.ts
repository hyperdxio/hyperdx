import { WebhookService } from '@hyperdx/common-utils/dist/types';

import { handleSendGenericWebhook } from './generic';
import { handleSendSlackWebhook } from './slack';
import type { ChannelTransport, WebhookTransport } from './types';

export { createHandlebarsWithHelpers } from './generic';
export { handleSendGenericWebhook } from './generic';
export { handleSendSlackWebhook } from './slack';
export * from './types';

/**
 * Webhook services registered against a transport. A downstream build adds a
 * new `WebhookService` here rather than editing `deliverWebhook`'s dispatch.
 *
 * @public
 */
export const webhookTransports: Partial<
  Record<WebhookService, WebhookTransport>
> = {
  [WebhookService.Slack]: handleSendSlackWebhook,
  [WebhookService.Generic]: handleSendGenericWebhook,
  [WebhookService.IncidentIO]: handleSendGenericWebhook,
};

const deliverWebhook: ChannelTransport = async (channel, message, ctx) => {
  if (channel.type !== 'webhook') {
    throw new Error(`Unsupported channel type: ${channel.type}`);
  }
  const transport =
    webhookTransports[channel.channel.service ?? WebhookService.Generic];
  if (!transport) {
    throw new Error(
      `Unsupported webhook service: ${channel.channel.service ?? WebhookService.Generic}`,
    );
  }
  await transport(channel, message, ctx.signal);
};

/**
 * Channel type is the first key and webhook service the second. OSS has one
 * channel type today, so the indirection looks unnecessary — it is what lets a
 * downstream build add a whole channel type (EE's email) as one entry instead
 * of patching the delivery path.
 *
 * @public
 */
export const channelTransports: Record<string, ChannelTransport> = {
  webhook: deliverWebhook,
};

export const deliverToChannel: ChannelTransport = async (
  channel,
  message,
  ctx,
) => {
  const transport = channelTransports[channel.type];
  if (!transport) {
    throw new Error(`Unsupported channel type: ${channel.type}`);
  }
  await transport(channel, message, ctx);
};
