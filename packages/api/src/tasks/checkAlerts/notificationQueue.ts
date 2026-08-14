import PQueue from '@esm2cjs/p-queue';
import opentelemetry, {
  Attributes,
  ROOT_CONTEXT,
  SpanContext,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';

import { IAlertError } from '@/models/alert';
import { makeWebhookAlertError } from '@/tasks/checkAlerts/errors';
import {
  NotificationDeliverFn,
  NotificationDispatcher,
  NotificationJob,
} from '@/tasks/checkAlerts/notifications';
import { deliverNotification } from '@/tasks/checkAlerts/template';
import { tasksTracer } from '@/tasks/tracer';
import {
  getCounter,
  recordOperationOutcome,
  setBusinessContext,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

// External endpoints are slow and untrusted; a small worker pool bounds the
// concurrent egress without ever blocking evaluation.
const DEFAULT_DELIVERY_CONCURRENCY = 20;

// Backpressure bound: beyond this many undelivered notifications, new ones
// are dropped (logged + counted) rather than growing memory without limit.
const DEFAULT_MAX_PENDING = 5_000;

// Delivery-failure buffer bounds. Failures are buffered per alert until the
// next evaluation drains them into the alert's executionErrors; a channel
// that fails on every group of a grouped alert would otherwise accumulate
// without limit between ticks.
const MAX_BUFFERED_FAILURES_PER_ALERT = 5;
const MAX_ALERTS_WITH_BUFFERED_FAILURES = 10_000;

const droppedNotificationsCounter = getCounter(
  'hyperdx.alerts.notifications_dropped',
  {
    description:
      'Count of alert notifications dropped by the in-process delivery queue, labeled by reason (overflow, shutdown).',
  },
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A dispatched job plus the context needed to trace its delivery back to the
 * evaluation that produced it. Queue-internal; never part of the job contract.
 */
type QueuedNotification = {
  job: NotificationJob;
  enqueuedAt: number;
  /** Span context of the evaluation active at dispatch time, if any. */
  originSpanContext?: SpanContext;
};

/**
 * Cross-tick, in-process notification delivery queue.
 *
 * Evaluations dispatch fully rendered NotificationJobs and continue
 * immediately; deliveries drain in the background on a bounded worker pool,
 * so a slow or hung endpoint never occupies an alert-evaluation slot or
 * extends the tick. Jobs sharing an eventId (same alert+channel+group)
 * deliver strictly in dispatch order, so a RESOLVED notification can never
 * overtake its still-pending ALERT.
 *
 * Accepted semantics vs inline delivery: alert state persists before the
 * webhook lands, so a crash loses queued notifications instead of duplicating
 * them, and a delivery failure reaches the alert's executionErrors one tick
 * late — it is buffered here and drained by the next evaluation via
 * drainDeliveryFailures() (in addition to surfacing immediately in logs and
 * the `alerts.notification_delivery` SLI).
 */
export class InProcessNotificationDispatcher implements NotificationDispatcher {
  private readonly queue: PQueue;
  /** Per-eventId chain tails enforcing FIFO delivery within a channel. */
  private readonly chains = new Map<string, Promise<unknown>>();
  /** Jobs accepted but not yet settled (queued, chained, or in flight). */
  private pendingCount = 0;
  private readonly maxPending: number;
  /**
   * Delivery failures awaiting pickup by the alert's next evaluation,
   * keyed by alertId. Bounded per alert and in tracked-alert count.
   */
  private readonly deliveryFailures = new Map<string, IAlertError[]>();

  constructor(
    private readonly deliver: NotificationDeliverFn = deliverNotification,
    opts?: { concurrency?: number; maxPending?: number },
  ) {
    this.queue = new PQueue({
      concurrency: opts?.concurrency ?? DEFAULT_DELIVERY_CONCURRENCY,
    });
    this.maxPending = opts?.maxPending ?? DEFAULT_MAX_PENDING;
  }

  /** Accept a job for background delivery. Resolves after enqueue. */
  async dispatch(job: NotificationJob): Promise<void> {
    if (this.pendingCount >= this.maxPending) {
      droppedNotificationsCounter.add(1, { reason: 'overflow' });
      logger.error(
        {
          alertId: job.alertId,
          eventId: job.eventId,
          pendingCount: this.pendingCount,
        },
        'Notification delivery queue overflow; dropping notification',
      );
      return;
    }

    const queued: QueuedNotification = {
      job,
      enqueuedAt: performance.now(),
      originSpanContext: opentelemetry.trace.getActiveSpan()?.spanContext(),
    };

    this.pendingCount++;
    const previousTail = this.chains.get(job.eventId) ?? Promise.resolve();
    // Only enqueue once the previous delivery for this eventId has settled.
    // deliverJob is structured to never reject, and the trailing catch makes
    // the stored link rejection-proof regardless: a broken link must neither
    // skip successors nor escalate to the process-killing
    // unhandledRejection handler in tasks/index.ts.
    const tail = previousTail
      .then(() => this.queue.add(() => this.deliverJob(queued)))
      .catch(() => {});
    this.chains.set(job.eventId, tail);
    void tail
      .finally(() => {
        this.pendingCount--;
        if (this.chains.get(job.eventId) === tail) {
          this.chains.delete(job.eventId);
        }
      })
      .catch(() => {});
  }

  /** Undelivered notifications (queued, chained, or in flight). */
  get pending(): number {
    return this.pendingCount;
  }

  /**
   * Return and clear the delivery failures buffered for this alert. Called by
   * the alert's next evaluation, which merges them into its executionErrors
   * so asynchronous webhook failures still surface on the alert.
   */
  drainDeliveryFailures(alertId: string): IAlertError[] {
    const errors = this.deliveryFailures.get(alertId);
    if (errors == null) {
      return [];
    }
    this.deliveryFailures.delete(alertId);
    return errors;
  }

  /**
   * Wait for pending deliveries to settle, giving up (and dropping whatever
   * remains) after deadlineMs. Call before process exit; the cron path never
   * calls this — the dispatcher outlives individual ticks by design.
   */
  async shutdown(deadlineMs: number): Promise<void> {
    const deadline = Date.now() + deadlineMs;
    while (this.pendingCount > 0 && Date.now() < deadline) {
      await sleep(25);
    }
    if (this.pendingCount > 0) {
      droppedNotificationsCounter.add(this.pendingCount, {
        reason: 'shutdown',
      });
      logger.error(
        { pendingCount: this.pendingCount, deadlineMs },
        'Notification queue shutdown deadline reached; dropping pending deliveries',
      );
    }
  }

  /**
   * Buffer a delivery failure for the next evaluation of its alert. Bounded:
   * per-alert only the most recent failures are kept, and past the
   * tracked-alert cap new alerts' failures stay log/metric-only rather than
   * growing memory without limit.
   */
  private recordDeliveryFailure(job: NotificationJob, err: unknown): void {
    const alertId = job.alertId;
    // Preview/template paths dispatch without a saved alert; there is no
    // executionErrors document to feed back into.
    if (alertId == null) {
      return;
    }
    const existing = this.deliveryFailures.get(alertId);
    if (
      existing == null &&
      this.deliveryFailures.size >= MAX_ALERTS_WITH_BUFFERED_FAILURES
    ) {
      logger.warn(
        { alertId, trackedAlerts: this.deliveryFailures.size },
        'Delivery-failure buffer is full; failure will not surface in executionErrors',
      );
      return;
    }
    const errors = existing ?? [];
    errors.push(makeWebhookAlertError(err));
    if (errors.length > MAX_BUFFERED_FAILURES_PER_ALERT) {
      errors.splice(0, errors.length - MAX_BUFFERED_FAILURES_PER_ALERT);
    }
    this.deliveryFailures.set(alertId, errors);
  }

  /**
   * Deliver one notification, never rejecting: a rejection here would surface
   * as an unhandledRejection (which the task runner escalates to
   * process.exit(1), dropping the whole queue) and would poison the
   * same-eventId chain. Delivery failures are handled with full semantics in
   * deliverJobInner; this catch is the last resort for anything unexpected
   * (malformed jobs, instrumentation errors).
   */
  private async deliverJob(queued: QueuedNotification): Promise<void> {
    try {
      await this.deliverJobInner(queued);
    } catch (err) {
      logger.error(
        {
          error: err,
          alertId: queued.job?.alertId,
          eventId: queued.job?.eventId,
        },
        'Unexpected error delivering alert notification',
      );
    }
  }

  /**
   * Deliver one notification inside its own root span. Delivery happens after
   * (and outside) the evaluation that produced it, so parenting under either
   * the origin evaluation span (already ended) or whatever tick happens to be
   * ambient at flush time would misattribute it — instead the span is a new
   * root carrying a link back to the origin evaluation.
   */
  private async deliverJobInner(queued: QueuedNotification): Promise<void> {
    const { job, enqueuedAt, originSpanContext } = queued;
    const startedAt = performance.now();

    // Wide event for the delivery: everything needed to slice failures and
    // backlog after the fact, without pre-declaring dimensions.
    const attributes: Attributes = {
      'hyperdx.alerts.notification.event_id': job.eventId,
      'hyperdx.alerts.notification.channel': job.channel.type,
      'hyperdx.alerts.notification.state': job.message.state,
      'hyperdx.alerts.notification.queue_wait_ms': Math.round(
        startedAt - enqueuedAt,
      ),
      'hyperdx.alerts.notification_queue.depth': this.pendingCount,
    };
    if (job.alertId != null) {
      attributes['hyperdx.alerts.alert.id'] = job.alertId;
    }
    if (job.group != null) {
      attributes['hyperdx.alerts.notification.group'] = job.group;
    }
    if (job.populatedChannel.type === 'webhook') {
      attributes['hyperdx.alerts.notification.webhook.service'] =
        job.populatedChannel.channel.service;
    }
    if (originSpanContext != null) {
      attributes['hyperdx.alerts.origin_trace_id'] = originSpanContext.traceId;
    }

    await tasksTracer.startActiveSpan(
      'deliverNotification',
      {
        kind: SpanKind.INTERNAL,
        links: originSpanContext ? [{ context: originSpanContext }] : [],
        attributes,
      },
      ROOT_CONTEXT,
      async span => {
        try {
          setBusinessContext({ teamId: job.teamId });
          await this.deliver(job);
          span.setStatus({ code: SpanStatusCode.OK });
          recordOperationOutcome({
            operation: 'alerts.notification_delivery',
            outcome: 'success',
            durationMs: performance.now() - startedAt,
          });
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(
            err instanceof Error ? err : new Error(String(err)),
          );
          recordOperationOutcome({
            operation: 'alerts.notification_delivery',
            outcome: 'error',
            durationMs: performance.now() - startedAt,
          });
          logger.error(
            {
              error: err,
              alertId: job.alertId,
              eventId: job.eventId,
              channelType: job.channel.type,
            },
            'Failed to deliver alert notification',
          );
          this.recordDeliveryFailure(job, err);
        } finally {
          span.end();
        }
      },
    );
  }
}

// Process-lifetime singleton: CheckAlertTask instances are created per cron
// tick, but deliveries must be able to outlive the tick that produced them.
let singleton: InProcessNotificationDispatcher | undefined;

/** The shared cross-tick notification dispatcher for the alert task. */
export const getNotificationDispatcher =
  (): InProcessNotificationDispatcher => {
    singleton ??= new InProcessNotificationDispatcher();
    return singleton;
  };

/**
 * Drain the singleton (if it was ever created) before process exit. Used by
 * the one-shot task runner path, where exiting immediately after execute()
 * would abandon queued deliveries.
 */
export const shutdownNotificationDispatcher = async (
  deadlineMs: number,
): Promise<void> => {
  if (singleton) {
    await singleton.shutdown(deadlineMs);
  }
};
