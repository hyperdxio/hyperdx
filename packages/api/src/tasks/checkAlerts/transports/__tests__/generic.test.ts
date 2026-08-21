import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';

import { AlertState } from '@/models/alert';
import {
  getWebhookFetchTimeoutMs,
  handleSendGenericWebhook,
} from '@/tasks/checkAlerts/transports/generic';
import type { Message } from '@/tasks/checkAlerts/transports/types';

const message: Message = {
  hdxLink: 'https://example.test/alert',
  title: 'title',
  body: 'body',
  state: AlertState.ALERT,
  startTime: 0,
  endTime: 1,
  eventId: 'evt-1',
};

const webhook: any = {
  _id: new ObjectId(),
  team: new ObjectId(),
  service: WebhookService.Generic,
  name: 'hanging-receiver',
  url: 'https://webhook.site/hang',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const channel: any = { type: 'webhook', channel: webhook };

describe('getWebhookFetchTimeoutMs', () => {
  const originalEnv = process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS;

  afterEach(() => {
    process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS = originalEnv;
  });

  it('defaults to 30s when unset', () => {
    delete process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS;
    expect(getWebhookFetchTimeoutMs()).toBe(30_000);
  });

  it('defaults to 30s when the env var is not a positive number', () => {
    process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS = 'not-a-number';
    expect(getWebhookFetchTimeoutMs()).toBe(30_000);
  });

  it('reads the configured override', () => {
    process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS = '5000';
    expect(getWebhookFetchTimeoutMs()).toBe(5000);
  });
});

describe('handleSendGenericWebhook — per-attempt timeout', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS = originalEnv;
  });

  it('aborts a receiver that accepts the connection and never responds', async () => {
    process.env.ALERT_NOTIFICATION_FETCH_TIMEOUT_MS = '50';

    // Real fetch implementations reject once the passed-in `signal` fires;
    // a mock that just returns a promise that never settles would pass
    // this test even if the send path never wired up a signal at all. This
    // mock only rejects via the signal, so the test actually proves the
    // code passes an AbortSignal that gets triggered by the timeout.
    const fetchMock: any = jest.fn(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal.reason);
          });
        }),
    );
    global.fetch = fetchMock;

    await expect(handleSendGenericWebhook(channel, message)).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 2000); // short test-level timeout: a regression here should fail fast, not stall on Jest's default 30s
});
