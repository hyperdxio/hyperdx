import type {
  Message,
  PopulatedAlertChannel,
} from '@/tasks/checkAlerts/transports';
import { deliverToChannel } from '@/tasks/checkAlerts/transports';

/**
 * Alert notification dispatch seam.
 *
 * Evaluation produces fully rendered NotificationJobs; a NotificationDispatcher
 * owns delivery. `eventId` is the idempotency key, so a queueing dispatcher can
 * deduplicate without re-deriving it.
 */
export type NotificationJob = {
  /** Idempotency key: objectHash(alertId, channel, group). */
  eventId: string;
  alertId?: string;
  teamId?: string;
  group?: string;
  /**
   * Named `populatedChannel`, not `channel`, deliberately: a downstream build
   * carries both a serializable channel *reference* and the resolved document,
   * and reusing `channel` for the resolved one collides with that.
   */
  populatedChannel: PopulatedAlertChannel;
  message: Message;
};

export type NotificationDeliverFn = (job: NotificationJob) => Promise<void>;

/**
 * dispatch() contract: the inline implementation resolves after delivery, so
 * errors propagate to the caller. Queueing implementations resolve after
 * enqueue; their errors surface in their own logs and metrics.
 */
export interface NotificationDispatcher {
  dispatch(job: NotificationJob): Promise<void>;
  /** Flush anything pending, giving up after deadlineMs. */
  shutdown(deadlineMs: number): Promise<void>;
}

/**
 * The default delivery implementation, wired to the transports registry. A
 * downstream dispatcher composes this rather than calling `deliverToChannel`
 * directly, so it stays swappable in one place.
 *
 * @public
 */
export const deliverNotification: NotificationDeliverFn = async job => {
  await deliverToChannel(job.populatedChannel, job.message, {
    group: job.group,
  });
};

/** Delivers synchronously so errors flow into the caller's executionErrors. */
export class InlineNotificationDispatcher implements NotificationDispatcher {
  constructor(private readonly deliver: NotificationDeliverFn) {}

  async dispatch(job: NotificationJob): Promise<void> {
    await this.deliver(job);
  }

  async shutdown(_deadlineMs: number): Promise<void> {
    // Nothing buffered.
  }
}

export const inlineNotificationDispatcher = new InlineNotificationDispatcher(
  deliverNotification,
);
