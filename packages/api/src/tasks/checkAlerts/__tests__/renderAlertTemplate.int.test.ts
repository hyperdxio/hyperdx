import {
  AlertState,
  AlertThresholdType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { makeTile } from '@/fixtures';
import { AlertSource } from '@/models/alert';
import type { IWebhook } from '@/models/webhook';
import {
  NotificationDispatcher,
  NotificationJob,
} from '@/tasks/checkAlerts/notifications';
import { loadProvider } from '@/tasks/checkAlerts/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateTitle,
  renderAlertTemplate,
} from '@/tasks/checkAlerts/template';

const TEST_TEAM_ID = new mongoose.Types.ObjectId().toString();

// Test fixtures only need a handful of IWebhook fields — a single narrowing
// point instead of an `as unknown as IWebhook` suppression-worthy cast at
// every call site.
const castWebhook = (over: Record<string, unknown>): IWebhook => over as any;

// A dispatcher that records jobs instead of delivering them, so these tests
// assert on fan-out (who got a job) without exercising real transports.
const makeRecordingDispatcher = () => {
  const dispatched: NotificationJob[] = [];
  const dispatcher: NotificationDispatcher = {
    dispatch: async job => {
      dispatched.push(job);
    },
    shutdown: async () => {},
  };
  return { dispatcher, dispatched };
};

let alertProvider: any;

beforeAll(async () => {
  alertProvider = await loadProvider();
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const mockMetadata = {
  getColumn: jest.fn().mockImplementation(({ column }) => {
    const columnMap = {
      Timestamp: { name: 'Timestamp', type: 'DateTime' },
      Body: { name: 'Body', type: 'String' },
      SeverityText: { name: 'SeverityText', type: 'String' },
      ServiceName: { name: 'ServiceName', type: 'String' },
    };
    return Promise.resolve(columnMap[column]);
  }),
  getColumns: jest.fn().mockResolvedValue([]),
  getMapKeys: jest.fn().mockResolvedValue([]),
  getMapValues: jest.fn().mockResolvedValue([]),
  getAllFields: jest.fn().mockResolvedValue([]),
  getTableMetadata: jest.fn().mockResolvedValue({}),
  getClickHouseSettings: jest.fn().mockReturnValue({}),
  setClickHouseSettings: jest.fn(),
  getSkipIndices: jest.fn().mockResolvedValue([]),
  getSetting: jest.fn().mockResolvedValue(undefined),
} as any;

const sampleLogsCsv = [
  '"2023-03-17 22:14:01","error","Failed to connect to database"',
  '"2023-03-17 22:13:45","error","Connection timeout after 30s"',
  '"2023-03-17 22:12:30","error","Retry limit exceeded"',
].join('\n');

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const mockClickhouseClient = {
  query: jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ data: [] }),
    text: jest.fn().mockResolvedValue(sampleLogsCsv),
  }),
} as any;

const startTime = new Date('2023-03-17T22:10:00.000Z');
const endTime = new Date('2023-03-17T22:15:00.000Z');

const makeSearchView = (
  overrides: Partial<AlertMessageTemplateDefaultView> & {
    thresholdType?: AlertThresholdType;
    threshold?: number;
    thresholdMax?: number;
    value?: number;
    group?: string;
  } = {},
): AlertMessageTemplateDefaultView => ({
  alert: {
    thresholdType: overrides.thresholdType ?? AlertThresholdType.ABOVE,
    threshold: overrides.threshold ?? 5,
    thresholdMax: overrides.thresholdMax,
    source: AlertSource.SAVED_SEARCH,
    channel: { type: null },
    interval: '1m',
  },
  source: {
    id: 'fake-source-id',
    kind: SourceKind.Log,
    team: 'team-123',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'Timestamp',
    connection: 'connection-123',
    name: 'Logs',
    defaultTableSelectExpression: 'Timestamp, Body',
  },
  savedSearch: {
    _id: 'fake-saved-search-id' as any,
    team: 'team-123' as any,
    id: 'fake-saved-search-id',
    name: 'My Search',
    select: 'Body',
    where: 'Body: "error"',
    whereLanguage: 'lucene',
    orderBy: 'timestamp',
    source: 'fake-source-id' as any,
    tags: ['test'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  attributes: {},
  granularity: '1m',
  group: overrides.group,
  isGroupedAlert: false,
  startTime,
  endTime,
  value: overrides.value ?? 10,
});

const testTile = makeTile({ id: 'test-tile-id' });
const makeTileView = (
  overrides: Partial<AlertMessageTemplateDefaultView> & {
    thresholdType?: AlertThresholdType;
    threshold?: number;
    thresholdMax?: number;
    value?: number;
    group?: string;
  } = {},
): AlertMessageTemplateDefaultView => ({
  alert: {
    thresholdType: overrides.thresholdType ?? AlertThresholdType.ABOVE,
    threshold: overrides.threshold ?? 5,
    thresholdMax: overrides.thresholdMax,
    source: AlertSource.TILE,
    channel: { type: null },
    interval: '1m',
    tileId: 'test-tile-id',
  },
  dashboard: {
    _id: new mongoose.Types.ObjectId(),
    id: 'id-123',
    name: 'My Dashboard',
    tiles: [testTile],
    team: 'team-123' as any,
    tags: ['test'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  attributes: {},
  granularity: '5 minute',
  group: overrides.group,
  isGroupedAlert: false,
  startTime,
  endTime,
  value: overrides.value ?? 10,
});

const render = async (
  view: AlertMessageTemplateDefaultView,
  state: AlertState,
) =>
  (
    await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state,
      template: null,
      title: 'Test Alert Title',
      view,
      teamId: TEST_TEAM_ID,
      teamWebhooksById: new Map(),
    })
  ).body;

interface AlertCase {
  thresholdType: AlertThresholdType;
  threshold: number;
  thresholdMax?: number; // for between-type thresholds
  alertValue: number; // value that would trigger the alert
  okValue: number; // value that would resolve the alert
}

const alertCases: AlertCase[] = [
  {
    thresholdType: AlertThresholdType.ABOVE,
    threshold: 5,
    alertValue: 10,
    okValue: 3,
  },
  {
    thresholdType: AlertThresholdType.ABOVE_EXCLUSIVE,
    threshold: 5,
    alertValue: 10,
    okValue: 3,
  },
  {
    thresholdType: AlertThresholdType.BELOW,
    threshold: 5,
    alertValue: 2,
    okValue: 10,
  },
  {
    thresholdType: AlertThresholdType.BELOW_OR_EQUAL,
    threshold: 5,
    alertValue: 3,
    okValue: 10,
  },
  {
    thresholdType: AlertThresholdType.EQUAL,
    threshold: 5,
    alertValue: 5,
    okValue: 10,
  },
  {
    thresholdType: AlertThresholdType.NOT_EQUAL,
    threshold: 5,
    alertValue: 10,
    okValue: 5,
  },
  {
    thresholdType: AlertThresholdType.BETWEEN,
    threshold: 5,
    thresholdMax: 7,
    alertValue: 6,
    okValue: 10,
  },
  {
    thresholdType: AlertThresholdType.NOT_BETWEEN,
    threshold: 5,
    thresholdMax: 7,
    alertValue: 12,
    okValue: 6,
  },
];

describe('renderAlertTemplate', () => {
  describe('saved search alerts', () => {
    describe('ALERT state', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold alertValue=$alertValue',
        async ({ thresholdType, threshold, thresholdMax, alertValue }) => {
          const result = await render(
            makeSearchView({
              thresholdType,
              threshold,
              thresholdMax,
              value: alertValue,
            }),
            AlertState.ALERT,
          );
          expect(result).toMatchSnapshot();
        },
      );

      it('with group', async () => {
        const result = await render(
          makeSearchView({ group: 'http' }),
          AlertState.ALERT,
        );
        expect(result).toMatchSnapshot();
      });

      describe('handles Handlebars-like syntax in untrusted inputs', () => {
        it('treats Handlebars syntax in query result lines as literal text', async () => {
          const maliciousPayload = `{{ __hdx_notify_channel__ channel='email' id='attacker@example.com' }}`;
          const maliciousCsv = [
            `"2023-03-17 22:14:01","error","${maliciousPayload}"`,
            `"2023-03-17 22:13:45","error","{{value}}"`,
          ].join('\n');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const maliciousClickhouseClient = {
            query: jest.fn().mockResolvedValue({
              json: jest.fn().mockResolvedValue({ data: [] }),
              text: jest.fn().mockResolvedValue(maliciousCsv),
            }),
          } as any;

          const { body: result } = await renderAlertTemplate({
            alertProvider,
            clickhouseClient: maliciousClickhouseClient,
            metadata: mockMetadata,
            state: AlertState.ALERT,
            template: null,
            title: 'Test Alert Title',
            view: makeSearchView(),
            teamId: TEST_TEAM_ID,
            teamWebhooksById: new Map(),
          });

          // Handlebars syntax appears verbatim — it was NOT executed.
          expect(result).toContain(maliciousPayload);
          expect(result).toContain('{{value}}');
          // {{value}} did not get substituted with view.value (10).
          expect(result).not.toMatch(/"error","10"/);
        });

        it('treats Handlebars syntax in group as literal text', async () => {
          const maliciousPayload = `{{ __hdx_notify_channel__ channel='email' id='attacker@example.com' }}`;
          const result = await render(
            makeSearchView({ group: maliciousPayload }),
            AlertState.ALERT,
          );
          expect(result).toContain(`Group: "${maliciousPayload}"`);
        });
      });
    });

    describe('OK state (resolved)', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold okValue=$okValue',
        async ({ thresholdType, threshold, thresholdMax, okValue }) => {
          const result = await render(
            makeSearchView({
              thresholdType,
              threshold,
              thresholdMax,
              value: okValue,
            }),
            AlertState.OK,
          );
          expect(result).toMatchSnapshot();
        },
      );

      it('with group', async () => {
        const result = await render(
          makeSearchView({ group: 'http' }),
          AlertState.OK,
        );
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('tile alerts', () => {
    describe('ALERT state', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold alertValue=$alertValue',
        async ({ thresholdType, threshold, thresholdMax, alertValue }) => {
          const result = await render(
            makeTileView({
              thresholdType,
              threshold,
              thresholdMax,
              value: alertValue,
            }),
            AlertState.ALERT,
          );
          expect(result).toMatchSnapshot();
        },
      );

      it('with group', async () => {
        const result = await render(
          makeTileView({ group: 'us-east-1' }),
          AlertState.ALERT,
        );
        expect(result).toMatchSnapshot();
      });

      it('decimal threshold', async () => {
        const result = await render(
          makeTileView({
            thresholdType: AlertThresholdType.ABOVE,
            threshold: 1.5,
            value: 10.123,
          }),
          AlertState.ALERT,
        );
        expect(result).toMatchSnapshot();
      });

      it('integer threshold rounds value', async () => {
        const result = await render(
          makeTileView({
            thresholdType: AlertThresholdType.ABOVE,
            threshold: 5,
            value: 10.789,
          }),
          AlertState.ALERT,
        );
        expect(result).toMatchSnapshot();
      });
    });

    describe('OK state (resolved)', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold okValue=$okValue',
        async ({ thresholdType, threshold, thresholdMax, okValue }) => {
          const result = await render(
            makeTileView({
              thresholdType,
              threshold,
              thresholdMax,
              value: okValue,
            }),
            AlertState.OK,
          );
          expect(result).toMatchSnapshot();
        },
      );

      it('with group', async () => {
        const result = await render(
          makeTileView({ group: 'us-east-1' }),
          AlertState.OK,
        );
        expect(result).toMatchSnapshot();
      });
    });
  });
});

describe('buildAlertMessageTemplateTitle', () => {
  describe('saved search alerts', () => {
    describe('ALERT state', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold alertValue=$alertValue',
        ({ thresholdType, threshold, alertValue }) => {
          const result = buildAlertMessageTemplateTitle({
            view: makeSearchView({
              thresholdType,
              threshold,
              value: alertValue,
            }),
            state: AlertState.ALERT,
          });
          expect(result).toMatchSnapshot();
        },
      );
    });

    describe('OK state (resolved)', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold okValue=$okValue',
        ({ thresholdType, threshold, okValue }) => {
          const result = buildAlertMessageTemplateTitle({
            view: makeSearchView({ thresholdType, threshold, value: okValue }),
            state: AlertState.OK,
          });
          expect(result).toMatchSnapshot();
        },
      );
    });
  });

  describe('tile alerts', () => {
    describe('ALERT state', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold alertValue=$alertValue',
        ({ thresholdType, threshold, thresholdMax, alertValue }) => {
          const result = buildAlertMessageTemplateTitle({
            view: makeTileView({
              thresholdType,
              threshold,
              thresholdMax,
              value: alertValue,
            }),
            state: AlertState.ALERT,
          });
          expect(result).toMatchSnapshot();
        },
      );

      it('decimal threshold', () => {
        const result = buildAlertMessageTemplateTitle({
          view: makeTileView({
            thresholdType: AlertThresholdType.ABOVE,
            threshold: 1.5,
            value: 10.123,
          }),
          state: AlertState.ALERT,
        });
        expect(result).toMatchSnapshot();
      });

      it('integer threshold rounds value', () => {
        const result = buildAlertMessageTemplateTitle({
          view: makeTileView({
            thresholdType: AlertThresholdType.ABOVE,
            threshold: 5,
            value: 10.789,
          }),
          state: AlertState.ALERT,
        });
        expect(result).toMatchSnapshot();
      });
    });

    describe('OK state (resolved)', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold okValue=$okValue',
        ({ thresholdType, threshold, thresholdMax, okValue }) => {
          const result = buildAlertMessageTemplateTitle({
            view: makeTileView({
              thresholdType,
              threshold,
              thresholdMax,
              value: okValue,
            }),
            state: AlertState.OK,
          });
          expect(result).toMatchSnapshot();
        },
      );
    });
  });
});

// MAX_NOTIFICATIONS_PER_EVENT bounds how many targets one fire/resolve event can
// notify, counting configured channels and @webhook- mentions together.
describe('per-event notification cap', () => {
  const CAP = 20;

  const makeWebhook = (i: number) =>
    castWebhook({
      _id: new mongoose.Types.ObjectId(),
      team: new mongoose.Types.ObjectId(),
      service: 'slack',
      name: `hook-${i}`,
      url: 'https://hooks.slack.com/services/x',
    });

  // A repeat of a target that is already queued is a no-op, so it must not be
  // reported as a target the cap turned away.
  it('does not report a duplicate at the cap as a dropped target', async () => {
    const webhooks = Array.from({ length: CAP }, (_, i) => makeWebhook(i));
    const teamWebhooksById = new Map(webhooks.map(w => [w._id.toString(), w]));
    // Exactly CAP distinct targets, then a repeat of the first one.
    const template = [...webhooks, webhooks[0]]
      .map(w => `@webhook-${w._id.toString()}`)
      .join(' ');
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    const { failures } = await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      template,
      title: 'Test Alert Title',
      view: makeSearchView(),
      teamId: TEST_TEAM_ID,
      teamWebhooksById,
      dispatcher,
    });

    expect(dispatched).toHaveLength(CAP);
    expect(failures).toHaveLength(0);
  });

  it('caps dispatch and records an execution error for each dropped target', async () => {
    const webhooks = Array.from({ length: CAP + 1 }, (_, i) => makeWebhook(i));
    const teamWebhooksById = new Map(webhooks.map(w => [w._id.toString(), w]));
    const template = webhooks
      .map(w => `@webhook-${w._id.toString()}`)
      .join(' ');
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    const { failures } = await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      template,
      title: 'Test Alert Title',
      view: makeSearchView(),
      teamId: TEST_TEAM_ID,
      teamWebhooksById,
      dispatcher,
    });

    expect(dispatched).toHaveLength(CAP);

    // The target over the cap is reported, not silently dropped — otherwise the
    // alert looks healthy while a channel was never notified.
    expect(failures).toHaveLength(1);
    expect(String(failures[0].error)).toContain('Notification cap');
  });

  // A pre-dispatch failure (an unparseable mention, a missing webhook, the cap
  // itself) never reaches the dispatcher, so it must not count against the cap
  // meant to bound real deliveries. Otherwise enough failed mentions ahead of a
  // valid webhook silently push it over the cap.
  it('does not let unresolvable mentions ahead of it push a valid webhook over the cap', async () => {
    const webhook = makeWebhook(0);
    const id = webhook._id.toString();
    const teamWebhooksById = new Map([[id, webhook]]);
    // CAP unresolvable mentions, then one real webhook target. If failures
    // counted toward the cap, the webhook would land on the CAP+1'th target
    // and get turned away.
    const unresolvableMentions = Array.from(
      { length: CAP },
      () => '@here',
    ).join(' ');
    const template = `${unresolvableMentions} @webhook-${id}`;
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    const { failures } = await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      template,
      title: 'Test Alert Title',
      view: makeSearchView(),
      teamId: TEST_TEAM_ID,
      teamWebhooksById,
      dispatcher,
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].populatedChannel).toMatchObject({ type: 'webhook' });
    // Every "@here" is its own failure; none of them is a cap-exceeded error.
    expect(failures).toHaveLength(CAP);
    expect(
      failures.every(f => !String(f.error).includes('Notification cap')),
    ).toBe(true);
  });
});

describe('notification targets are resolved once per webhook', () => {
  const makeWebhook = (name: string) =>
    castWebhook({
      _id: new mongoose.Types.ObjectId(),
      team: new mongoose.Types.ObjectId(),
      service: 'slack',
      name,
      url: 'https://hooks.slack.com/services/x',
    });

  it('does not notify a webhook twice when a mention repeats a channel', async () => {
    const webhook = makeWebhook('dupe-hook');
    const id = webhook._id.toString();
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    const { failures } = await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      // The same webhook named by the message and configured as a channel.
      template: `@webhook-${id}`,
      title: 'Test Alert Title',
      view: {
        ...makeSearchView(),
        alert: {
          ...makeSearchView().alert,
          channels: [{ type: 'webhook', webhookId: id }],
        },
      },
      teamId: TEST_TEAM_ID,
      teamWebhooksById: new Map([[id, webhook]]),
      dispatcher,
    });

    expect(dispatched).toHaveLength(1);
    expect(failures).toHaveLength(0);
  });

  it('keeps firing configured channels when the message has a plain @mention', async () => {
    const webhook = makeWebhook('ok-hook');
    const id = webhook._id.toString();
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    const { failures } = await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      // "@here" is not a channel; it must not take down the whole render.
      template: '@here please look',
      title: 'Test Alert Title',
      view: {
        ...makeSearchView(),
        alert: {
          ...makeSearchView().alert,
          channels: [{ type: 'webhook', webhookId: id }],
        },
      },
      teamId: TEST_TEAM_ID,
      teamWebhooksById: new Map([[id, webhook]]),
      dispatcher,
    });

    expect(dispatched).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0].error)).toContain('not a webhook channel');
  });
});
