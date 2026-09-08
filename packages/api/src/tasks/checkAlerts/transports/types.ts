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
  // Enriched fields exposed as Generic/incident.io template variables.
  // Optional so existing callers and non-enriched templates are unaffected.
  alertId?: string;
  status?: string; // firing | resolved | no_data | pending
  alertType?: string; // search | dashboard_chart
  comparator?: string; // >=, >, <=, <, =, !=, between, outside
  threshold?: number;
  thresholdMax?: number; // upper bound; only set when comparator is between/outside
  value?: number; // the value that triggered/resolved the alert
  groupKey?: string;
  sourceQuery?: string; // the search expr / SQL that defines the alert
  teamId?: string;
  note?: string; // freeform alert note (markdown); commonly holds a runbook link
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
