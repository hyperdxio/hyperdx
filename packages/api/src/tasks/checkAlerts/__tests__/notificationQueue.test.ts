import { AlertErrorType } from '@hyperdx/common-utils/dist/types';

import { AlertState } from '@/models/alert';
import { WebhookRedirectError } from '@/tasks/checkAlerts/errors';
import { InProcessNotificationDispatcher } from '@/tasks/checkAlerts/notificationQueue';
import { NotificationJob } from '@/tasks/checkAlerts/notifications';
import { tasksTracer } from '@/tasks/tracer';

const makeJob = (eventId: string, title = 'Alert fired'): NotificationJob =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  ({
    v: 1,
    eventId,
    alertId: 'alert-1',
    channel: { type: 'webhook', webhookId: 'webhook-1' },
    message: {
      hdxLink: 'https://app.example.com/search/1',
      title,
      body: 'body',
      state: AlertState.ALERT,
      startTime: 1700000000000,
      endTime: 1700000060000,
      eventId,
    },
    populatedChannel: { type: 'webhook', channel: {} },
  }) as unknown as NotificationJob;

/** A controllable delivery: each call returns a promise the test resolves. */
const makeControlledDeliver = () => {
  const settled: Array<() => void> = [];
  const failed: Array<(err: Error) => void> = [];
  const calls: NotificationJob[] = [];
  const deliver = jest.fn((job: NotificationJob) => {
    calls.push(job);
    return new Promise<void>((resolve, reject) => {
      settled.push(resolve);
      failed.push(reject);
    });
  });
  return { deliver, settled, failed, calls };
};

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('InProcessNotificationDispatcher', () => {
  it('dispatch resolves before delivery completes', async () => {
    const { deliver, settled } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await dispatcher.dispatch(makeJob('a'));
    await tick();

    // Delivery started but has not settled — dispatch didn't wait for it.
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(dispatcher.pending).toBe(1);

    settled[0]();
    await tick();
    expect(dispatcher.pending).toBe(0);
  });

  it('serializes deliveries sharing an eventId (RESOLVED never overtakes ALERT)', async () => {
    const { deliver, settled, calls } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await dispatcher.dispatch(makeJob('same', 'ALERT'));
    await dispatcher.dispatch(makeJob('same', 'RESOLVED'));
    await tick();

    // Second delivery must not start while the first is in flight.
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(calls[0].message.title).toBe('ALERT');

    settled[0]();
    await tick();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(calls[1].message.title).toBe('RESOLVED');
  });

  it('delivers different eventIds concurrently', async () => {
    const { deliver } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await dispatcher.dispatch(makeJob('a'));
    await dispatcher.dispatch(makeJob('b'));
    await tick();

    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('a failed delivery does not break the eventId chain or reject anything', async () => {
    const { deliver, settled, failed } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await dispatcher.dispatch(makeJob('same'));
    await dispatcher.dispatch(makeJob('same'));
    await tick();

    failed[0](new Error('endpoint down'));
    await tick();

    // The failure was swallowed and the next chained delivery started.
    expect(deliver).toHaveBeenCalledTimes(2);
    settled[1]();
    await dispatcher.shutdown(1_000);
    expect(dispatcher.pending).toBe(0);
  });

  it('drops new jobs beyond maxPending', async () => {
    const { deliver } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver, {
      maxPending: 2,
    });

    await dispatcher.dispatch(makeJob('a'));
    await dispatcher.dispatch(makeJob('b'));
    await dispatcher.dispatch(makeJob('c'));
    await tick();

    expect(dispatcher.pending).toBe(2);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'c' }),
    );
  });

  it('shutdown waits for pending deliveries', async () => {
    const { deliver, settled } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await dispatcher.dispatch(makeJob('a'));
    await tick();

    const shutdown = dispatcher.shutdown(5_000);
    settled[0]();
    await shutdown;

    expect(dispatcher.pending).toBe(0);
  });

  it('shutdown gives up at the deadline when a delivery never settles', async () => {
    const { deliver } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await dispatcher.dispatch(makeJob('stuck'));
    await tick();

    const startedAt = performance.now();
    await dispatcher.shutdown(100);

    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(dispatcher.pending).toBe(1);
  });

  describe('when delivery machinery itself throws (not the endpoint)', () => {
    // The task runner's unhandledRejection handler exits the process, so no
    // queue-side throw may ever escape as an unhandled rejection.
    let unhandledRejections: unknown[];
    let onUnhandledRejection: (reason: unknown) => void;

    beforeEach(() => {
      unhandledRejections = [];
      onUnhandledRejection = reason => unhandledRejections.push(reason);
      process.on('unhandledRejection', onUnhandledRejection);
    });

    afterEach(() => {
      process.off('unhandledRejection', onUnhandledRejection);
    });

    // Attribute building reads populatedChannel before delivery starts;
    // stripping it makes the pre-delivery span setup throw.
    const makeMalformedJob = (eventId: string): NotificationJob => {
      const job = makeJob(eventId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      delete (job as any).populatedChannel;
      return job;
    };

    it('never escalates to an unhandled rejection', async () => {
      const { deliver } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      await dispatcher.dispatch(makeMalformedJob('boom'));
      await dispatcher.shutdown(1_000);
      // Give any stray rejection a macrotask to surface.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(unhandledRejections).toEqual([]);
      expect(dispatcher.pending).toBe(0);
      expect(deliver).not.toHaveBeenCalled();
    });

    it('does not poison the same-eventId chain', async () => {
      const { deliver, settled } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      await dispatcher.dispatch(makeMalformedJob('same'));
      await dispatcher.dispatch(makeJob('same', 'AFTER'));
      await tick();

      // The broken link was swallowed and the follow-up still delivers.
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ title: 'AFTER' }),
        }),
      );

      settled[0]();
      await dispatcher.shutdown(1_000);
      expect(dispatcher.pending).toBe(0);
      expect(unhandledRejections).toEqual([]);
    });
  });

  it('delivers jobs dispatched from inside an active span (origin link capture)', async () => {
    const { deliver, settled } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver);

    await tasksTracer.startActiveSpan('processAlert', async span => {
      await dispatcher.dispatch(makeJob('a'));
      span.end();
    });
    await tick();

    expect(deliver).toHaveBeenCalledTimes(1);
    settled[0]();
    await dispatcher.shutdown(1_000);
    expect(dispatcher.pending).toBe(0);
  });

  it('respects the delivery concurrency limit', async () => {
    const { deliver } = makeControlledDeliver();
    const dispatcher = new InProcessNotificationDispatcher(deliver, {
      concurrency: 2,
    });

    for (const id of ['a', 'b', 'c', 'd']) {
      await dispatcher.dispatch(makeJob(id));
    }
    await tick();

    // Only `concurrency` deliveries are in flight at once.
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  describe('delivery-failure feedback (drainDeliveryFailures)', () => {
    it('buffers a WEBHOOK_ERROR per failed delivery and drains once', async () => {
      const { deliver, failed } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      await dispatcher.dispatch(makeJob('a'));
      await tick();
      failed[0](new Error('endpoint down'));
      await dispatcher.shutdown(1_000);

      const drained = dispatcher.drainDeliveryFailures('alert-1');
      expect(drained).toHaveLength(1);
      expect(drained[0].type).toBe(AlertErrorType.WEBHOOK_ERROR);

      // Draining clears the buffer.
      expect(dispatcher.drainDeliveryFailures('alert-1')).toEqual([]);
    });

    it('preserves the redirect-specific message for WebhookRedirectError', async () => {
      const { deliver, failed } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      await dispatcher.dispatch(makeJob('a'));
      await tick();
      failed[0](new WebhookRedirectError(302));
      await dispatcher.shutdown(1_000);

      const drained = dispatcher.drainDeliveryFailures('alert-1');
      expect(drained).toHaveLength(1);
      expect(drained[0].message).toMatch(/redirect/i);
    });

    it('does not buffer successful deliveries', async () => {
      const { deliver, settled } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      await dispatcher.dispatch(makeJob('a'));
      await tick();
      settled[0]();
      await dispatcher.shutdown(1_000);

      expect(dispatcher.drainDeliveryFailures('alert-1')).toEqual([]);
    });

    it('keeps failures per alert and only the most recent per alert (bounded)', async () => {
      const { deliver, failed } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      // 7 failures for alert-1 (distinct eventIds so they run unchained),
      // 1 for alert-2.
      for (let i = 0; i < 7; i++) {
        await dispatcher.dispatch(makeJob(`a-${i}`));
      }
      const otherAlertJob = {
        ...makeJob('b-0'),
        alertId: 'alert-2',
      } as NotificationJob;
      await dispatcher.dispatch(otherAlertJob);
      await tick();
      failed.forEach(reject => reject(new Error('endpoint down')));
      await dispatcher.shutdown(1_000);

      // Capped at the 5 most recent for alert-1; alert-2 is tracked apart.
      expect(dispatcher.drainDeliveryFailures('alert-1')).toHaveLength(5);
      expect(dispatcher.drainDeliveryFailures('alert-2')).toHaveLength(1);
    });

    it('ignores failures for jobs without an alertId (preview paths)', async () => {
      const { deliver, failed } = makeControlledDeliver();
      const dispatcher = new InProcessNotificationDispatcher(deliver);

      const previewJob = {
        ...makeJob('a'),
        alertId: undefined,
      } as NotificationJob;
      await dispatcher.dispatch(previewJob);
      await tick();
      failed[0](new Error('endpoint down'));
      await dispatcher.shutdown(1_000);

      expect(dispatcher.drainDeliveryFailures('alert-1')).toEqual([]);
    });
  });
});
