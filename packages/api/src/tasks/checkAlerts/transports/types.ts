import { AlertState } from '@/models/alert';
import type { PopulatedAlertChannel } from '@/tasks/checkAlerts/providers';

// Re-exported so consumers import channel types from one place.
export type { PopulatedAlertChannel };

export interface Message {
  hdxLink: string;
  title: string;
  body: string;
  state: AlertState;
  startTime: number;
  endTime: number;
  eventId: string;
}

export type WebhookChannel = Extract<
  PopulatedAlertChannel,
  { type: 'webhook' }
>;

/** Sends one rendered message over one webhook service. Rejections mean delivery failed. */
export type WebhookTransport = (
  channel: WebhookChannel,
  message: Message,
  signal?: AbortSignal,
) => Promise<void>;

/**
 * Sends one rendered message to one channel type. Keyed on channel type, not
 * webhook service, so a new channel type is an added entry rather than an edit
 * to the delivery switch.
 */
export type ChannelTransport = (
  channel: PopulatedAlertChannel,
  message: Message,
  ctx: { group?: string; signal?: AbortSignal },
) => Promise<void>;
