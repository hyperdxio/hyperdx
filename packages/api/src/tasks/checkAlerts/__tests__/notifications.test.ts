import { AlertState } from '@/models/alert';
import {
  InlineNotificationDispatcher,
  NotificationJob,
  NotificationJobCore,
  zNotificationJobCore,
} from '@/tasks/checkAlerts/notifications';

const jobCore: NotificationJobCore = {
  v: 1,
  eventId: 'event-abc',
  alertId: 'alert-1',
  teamId: 'team-1',
  group: 'ServiceName:api',
  channel: {
    type: 'webhook',
    webhookId: 'webhook-1',
  },
  message: {
    hdxLink: 'https://app.example.com/search/1',
    title: 'Alert fired',
    body: 'value over threshold',
    state: AlertState.ALERT,
    startTime: 1700000000000,
    endTime: 1700000060000,
    eventId: 'event-abc',
  },
};

describe('NotificationJob contract', () => {
  it('survives a JSON round trip — the future wire contract', () => {
    const roundTripped = zNotificationJobCore.parse(
      JSON.parse(JSON.stringify(jobCore)),
    );
    expect(roundTripped).toEqual(jobCore);
  });

  it('rejects unknown channel types', () => {
    expect(() =>
      zNotificationJobCore.parse({
        ...jobCore,
        channel: { type: 'carrier-pigeon' },
      }),
    ).toThrow();
  });
});

describe('InlineNotificationDispatcher', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const job = {
    ...jobCore,
    populatedChannel: { type: 'webhook', channel: {} },
  } as unknown as NotificationJob;

  it('delivers synchronously and resolves on success', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new InlineNotificationDispatcher(deliver);

    await dispatcher.dispatch(job);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(job);
  });

  it('propagates delivery errors to the caller (pre-seam parity)', async () => {
    const deliver = jest.fn().mockRejectedValue(new Error('endpoint down'));
    const dispatcher = new InlineNotificationDispatcher(deliver);

    await expect(dispatcher.dispatch(job)).rejects.toThrow('endpoint down');
  });

  it('shutdown is a no-op', async () => {
    const dispatcher = new InlineNotificationDispatcher(jest.fn());
    await expect(dispatcher.shutdown(1_000)).resolves.toBeUndefined();
  });

  it('buffers no delivery failures — errors propagate inline instead', async () => {
    const deliver = jest.fn().mockRejectedValue(new Error('endpoint down'));
    const dispatcher = new InlineNotificationDispatcher(deliver);

    await expect(dispatcher.dispatch(job)).rejects.toThrow('endpoint down');
    expect(dispatcher.drainDeliveryFailures('alert-1')).toEqual([]);
  });
});
