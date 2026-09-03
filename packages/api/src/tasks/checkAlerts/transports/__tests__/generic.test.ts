import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';

import { AlertState } from '@/models/alert';
import {
  buildWebhookTemplateVariables,
  createHandlebarsWithHelpers,
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

describe('buildWebhookTemplateVariables', () => {
  it('exposes the enriched variables alongside the original set', () => {
    const vars = buildWebhookTemplateVariables({
      ...message,
      startTime: 1700000000000,
      endTime: 1700000300000,
      alertId: 'alert-1',
      status: 'firing',
      alertType: 'search',
      comparator: '>=',
      threshold: 5,
      thresholdMax: 20,
      value: 42,
      groupKey: 'checkout',
      sourceQuery: 'Body: "error"',
      teamId: 'team-1',
      note: 'Runbook: https://wiki.example/runbook',
    });

    expect(vars).toMatchObject({
      eventId: 'evt-1',
      state: AlertState.ALERT,
      alertId: 'alert-1',
      status: 'firing',
      alertType: 'search',
      comparator: '>=',
      threshold: 5,
      thresholdMax: 20,
      value: 42,
      groupKey: 'checkout',
      teamId: 'team-1',
      startTimeISO: new Date(1700000000000).toISOString(),
      endTimeISO: new Date(1700000300000).toISOString(),
    });
    // Strings destined for JSON template slots are escaped.
    expect(vars.sourceQuery).toBe('Body: \\"error\\"');
  });

  it('renders enriched fields as empty strings (never "undefined") when absent', () => {
    const vars = buildWebhookTemplateVariables(message);
    expect(vars.alertId).toBe('');
    expect(vars.status).toBe('');
    expect(vars.note).toBe('');
    expect(vars.thresholdMax).toBeUndefined();
    expect(vars.startTimeISO).toBe(new Date(0).toISOString());
  });
});

// The guard published in docs/alert-webhook-template-variables.md is the only
// way a receiver can put an optional number in an unquoted JSON slot, so a
// change to the helper set that breaks it would break every template using it.
describe('the documented guard for an optional numeric variable', () => {
  const render = (thresholdMax?: number) =>
    createHandlebarsWithHelpers().compile(
      '{"threshold": {{threshold}}{{#unless (eq thresholdMax undefined)}}, "threshold_max": {{thresholdMax}}{{/unless}}\n}',
    )(
      buildWebhookTemplateVariables({ ...message, threshold: 5, thresholdMax }),
    );

  it.each([
    [undefined, { threshold: 5 }],
    [20, { threshold: 5, threshold_max: 20 }],
    // A range bounded at zero is real, and `{{#if}}` would drop it.
    [0, { threshold: 5, threshold_max: 0 }],
  ])('renders valid JSON for thresholdMax=%s', (thresholdMax, expected) => {
    expect(JSON.parse(render(thresholdMax))).toEqual(expected);
  });
});
