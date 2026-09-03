import {
  AlertChartConfig,
  AlertState,
  AlertThresholdType,
  DisplayType,
  SourceKind,
  Tile,
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
    tile?: Tile;
  } = {},
): AlertMessageTemplateDefaultView => ({
  alert: {
    thresholdType: overrides.thresholdType ?? AlertThresholdType.ABOVE,
    threshold: overrides.threshold ?? 5,
    thresholdMax: overrides.thresholdMax,
    source: AlertSource.TILE,
    channel: { type: null },
    interval: '1m',
    tileId: (overrides.tile ?? testTile).id,
  },
  dashboard: {
    _id: new mongoose.Types.ObjectId(),
    id: 'id-123',
    name: 'My Dashboard',
    tiles: [overrides.tile ?? testTile],
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

// An inline alert carries its own chart config, either builder (`where`) or
// raw SQL (`sqlTemplate`) — the two places its query can live.
const makeInlineChartConfig = (
  query: { where: string } | { sqlTemplate: string },
): AlertChartConfig =>
  'sqlTemplate' in query
    ? {
        name: 'Inline SQL',
        configType: 'sql',
        connection: 'connection-123',
        displayType: DisplayType.Line,
        sqlTemplate: query.sqlTemplate,
      }
    : {
        name: 'Inline Chart',
        source: 'fake-source-id',
        displayType: DisplayType.Line,
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ],
        where: query.where,
        whereLanguage: 'lucene',
      };

const makeInlineView = (
  query: { where: string } | { sqlTemplate: string },
): AlertMessageTemplateDefaultView => ({
  alert: {
    thresholdType: AlertThresholdType.ABOVE,
    threshold: 5,
    source: AlertSource.INLINE,
    channel: { type: null },
    interval: '1m',
    chartConfig: makeInlineChartConfig(query),
  },
  attributes: {},
  granularity: '5 minute',
  isGroupedAlert: false,
  startTime,
  endTime,
  value: 10,
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

// The enriched fields are what a receiver routes and dedupes on, so they have
// to survive the render, not just the variable builder in isolation.
describe('enriched message fields', () => {
  const renderView = async (
    state: AlertState,
    base: AlertMessageTemplateDefaultView,
  ) => {
    const webhook = castWebhook({
      _id: new mongoose.Types.ObjectId(),
      team: new mongoose.Types.ObjectId(),
      service: 'slack',
      name: 'enriched-hook',
      url: 'https://hooks.slack.com/services/x',
    });
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    const result = await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state,
      template: null,
      title: 'Test Alert Title',
      view: {
        ...base,
        alert: {
          ...base.alert,
          channel: { type: 'webhook', webhookId: webhook._id.toString() },
          channels: [{ type: 'webhook', webhookId: webhook._id.toString() }],
        },
      },
      teamId: TEST_TEAM_ID,
      teamWebhooksById: new Map([[webhook._id.toString(), webhook]]),
      dispatcher,
    });
    return { dispatched, result };
  };

  const renderWithWebhook = async (
    state: AlertState,
    viewOverrides: Parameters<typeof makeSearchView>[0] = {},
  ) => renderView(state, makeSearchView(viewOverrides));

  it('carries the alert identity and condition onto the dispatched job', async () => {
    const { dispatched, result } = await renderWithWebhook(AlertState.ALERT, {
      group: 'http',
    });

    expect(result.failures).toEqual([]);
    expect(dispatched[0].message).toMatchObject({
      status: 'firing',
      alertType: 'search',
      comparator: '>=',
      threshold: 5,
      groupKey: 'http',
      sourceQuery: 'Body: "error"',
      teamId: TEST_TEAM_ID,
    });
  });

  it('reports a resolve as resolved', async () => {
    const { dispatched } = await renderWithWebhook(AlertState.OK);

    expect(dispatched[0].message).toMatchObject({ status: 'resolved' });
  });

  it('carries both bounds of a range condition', async () => {
    const { dispatched } = await renderWithWebhook(AlertState.ALERT, {
      thresholdType: AlertThresholdType.BETWEEN,
      threshold: 5,
      thresholdMax: 7,
      value: 6,
    });

    expect(dispatched[0].message).toMatchObject({
      comparator: 'between',
      threshold: 5,
      thresholdMax: 7,
    });
  });

  it('omits the upper bound when the condition is not a range', async () => {
    const { dispatched } = await renderWithWebhook(AlertState.ALERT, {
      thresholdType: AlertThresholdType.ABOVE,
      threshold: 5,
      // Set but irrelevant to this comparator — it must not reach the receiver.
      thresholdMax: 7,
    });

    expect(dispatched[0].message.thresholdMax).toBeUndefined();
  });

  it('reads sourceQuery from the tile a dashboard alert points at', async () => {
    const tile = makeTile({ id: 'queried-tile' });
    tile.config = makeInlineChartConfig({ where: 'ServiceName: "checkout"' });

    const { dispatched } = await renderView(
      AlertState.ALERT,
      makeTileView({ tile }),
    );

    expect(dispatched[0].message).toMatchObject({
      alertType: 'dashboard_chart',
      sourceQuery: 'ServiceName: "checkout"',
    });
  });

  it('reads sourceQuery from an inline builder alert', async () => {
    const { dispatched } = await renderView(
      AlertState.ALERT,
      makeInlineView({ where: 'SeverityText: "error"' }),
    );

    expect(dispatched[0].message).toMatchObject({
      alertType: 'inline_query',
      sourceQuery: 'SeverityText: "error"',
    });
  });

  it('reads sourceQuery from an inline raw SQL alert', async () => {
    const { dispatched } = await renderView(
      AlertState.ALERT,
      makeInlineView({ sqlTemplate: 'SELECT count() FROM otel_logs' }),
    );

    expect(dispatched[0].message).toMatchObject({
      sourceQuery: 'SELECT count() FROM otel_logs',
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

  // The alert's own channels used to be appended to the template as
  // `@webhook-<id>` mentions, after whatever the user wrote — so a message
  // body carrying CAP mentions consumed every slot and the configured channel,
  // the one target the alert was actually set up to notify, was never reached.
  it('notifies a configured channel even when the body is full of mentions', async () => {
    const configured = makeWebhook(999);
    const mentioned = Array.from({ length: CAP }, (_, i) => makeWebhook(i));
    const teamWebhooksById = new Map(
      [configured, ...mentioned].map(w => [w._id.toString(), w]),
    );
    const template = mentioned
      .map(w => `@webhook-${w._id.toString()}`)
      .join(' ');
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      template,
      title: 'Test Alert Title',
      view: {
        ...makeSearchView(),
        alert: {
          ...makeSearchView().alert,
          channel: { type: 'webhook', webhookId: configured._id.toString() },
          channels: [{ type: 'webhook', webhookId: configured._id.toString() }],
        },
      },
      teamId: TEST_TEAM_ID,
      teamWebhooksById,
      dispatcher,
    });

    expect(
      dispatched.map(j => j.populatedChannel.channel._id.toString()),
    ).toContain(configured._id.toString());
  });

  // A configured channel and an `@mention` must deliver byte-identical bodies.
  // Both render through the same Handlebars instance (the one with `is_match`
  // enabled), and only that instance's output is ever delivered — the body
  // returned by renderAlertTemplate is rendered separately, with `is_match`
  // suppressed, and goes to the caller rather than to a channel. Pinned here
  // so the two delivery paths cannot drift.
  it('delivers the same body to a configured channel and a mentioned one', async () => {
    const configured = makeWebhook(1);
    const mentioned = makeWebhook(2);
    const teamWebhooksById = new Map(
      [configured, mentioned].map(w => [w._id.toString(), w]),
    );
    const { dispatcher, dispatched } = makeRecordingDispatcher();

    await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      template: `{{#is_match "group" "http"}}routed{{/is_match}} @webhook-${mentioned._id.toString()}`,
      title: 'Test Alert Title',
      view: {
        ...makeSearchView({ group: 'http' }),
        alert: {
          ...makeSearchView().alert,
          channel: { type: 'webhook', webhookId: configured._id.toString() },
          channels: [{ type: 'webhook', webhookId: configured._id.toString() }],
        },
      },
      teamId: TEST_TEAM_ID,
      teamWebhooksById,
      dispatcher,
    });

    expect(dispatched).toHaveLength(2);
    const bodies = new Set(dispatched.map(j => j.message.body));
    expect(bodies.size).toBe(1);
    // And the routing block really is present, so this is not passing on two
    // empty strings.
    expect([...bodies][0]).toContain('routed');
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
