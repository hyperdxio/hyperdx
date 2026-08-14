import { z } from 'zod';

import { AlertState, IAlertError } from '@/models/alert';
import { PopulatedAlertChannel } from '@/tasks/checkAlerts/providers';

/**
 * Alert notification dispatch seam.
 *
 * Evaluation produces fully rendered NotificationJobs; a NotificationDispatcher
 * owns delivery. Today's implementations are in-process, but the job's
 * serializable core is designed as the wire contract for a future standalone
 * notification service: `eventId` is the idempotency key, and the channel is
 * referenced by id — never by live document.
 */

/** Fully rendered notification content, ready for delivery to any channel. */
const zNotificationMessage = z.object({
  hdxLink: z.string(),
  title: z.string(),
  body: z.string(),
  state: z.nativeEnum(AlertState),
  startTime: z.number(),
  endTime: z.number(),
  eventId: z.string(),
});
export type NotificationMessage = z.infer<typeof zNotificationMessage>;

/**
 * The serializable core of a notification job — the future notification
 * service's wire contract. Must never carry live mongoose documents, secrets
 * beyond the channel reference, or ClickHouse client state.
 */
export const zNotificationJobCore = z.object({
  v: z.literal(1),
  /**
   * Idempotency key: stable hash of (alert, channel, group) — see the eventId
   * computation in renderAlertTemplate.
   */
  eventId: z.string(),
  // Optional because template preview paths render without a saved alert; the
  // task path always sets it.
  alertId: z.string().optional(),
  teamId: z.string().optional(),
  group: z.string().optional(),
  channel: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('webhook'),
      webhookId: z.string(),
    }),
  ]),
  message: zNotificationMessage,
});
export type NotificationJobCore = z.infer<typeof zNotificationJobCore>;

/**
 * A dispatchable notification. `populatedChannel` is transport-local: the
 * in-process dispatchers deliver with the already-resolved channel (webhook
 * doc including secrets); a future out-of-process transport serializes only
 * the core and re-resolves the channel from its own store.
 */
export type NotificationJob = NotificationJobCore & {
  populatedChannel: PopulatedAlertChannel;
};

/** Delivers one job to its channel. Rejections signal delivery failure. */
export type NotificationDeliverFn = (job: NotificationJob) => Promise<void>;

/**
 * Transport seam for notification delivery, mirroring the AlertProvider
 * pattern: evaluation code only ever calls dispatch().
 *
 * dispatch() contract: the inline implementation resolves after delivery
 * (errors propagate to the caller); queueing implementations resolve after
 * enqueue and instead buffer delivery failures for the next evaluation to
 * drain via drainDeliveryFailures().
 */
export interface NotificationDispatcher {
  dispatch(job: NotificationJob): Promise<void>;
  /** Flush anything pending, giving up after deadlineMs. */
  shutdown(deadlineMs: number): Promise<void>;
  /**
   * Return and clear the delivery failures buffered for the given alert since
   * its last drain. Evaluations merge these into the alert's executionErrors
   * so asynchronous delivery failures still surface on the alert (one tick
   * late). Inline delivery propagates errors to the caller directly, so the
   * inline implementation always returns an empty array.
   */
  drainDeliveryFailures(alertId: string): IAlertError[];
}

/**
 * Default dispatcher: delivers synchronously so errors flow into the calling
 * evaluation's executionErrors — the original inline behavior.
 */
export class InlineNotificationDispatcher implements NotificationDispatcher {
  constructor(private readonly deliver: NotificationDeliverFn) {}

  async dispatch(job: NotificationJob): Promise<void> {
    await this.deliver(job);
  }

  async shutdown(_deadlineMs: number): Promise<void> {
    // Nothing buffered.
  }

  drainDeliveryFailures(_alertId: string): IAlertError[] {
    // Inline delivery rejects dispatch() itself; nothing is buffered.
    return [];
  }
}
