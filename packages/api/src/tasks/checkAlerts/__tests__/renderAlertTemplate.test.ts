import {
  AlertState,
  AlertThresholdType,
  SourceKind,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { makeTile } from '@/fixtures';
import { AlertSource } from '@/models/alert';
import { loadProvider } from '@/tasks/checkAlerts/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAgentPrompt,
  buildAlertMessageTemplateTitle,
  handleStartAgentSession,
  renderAlertTemplate,
} from '@/tasks/checkAlerts/template';

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

const render = (view: AlertMessageTemplateDefaultView, state: AlertState) =>
  renderAlertTemplate({
    alertProvider,
    clickhouseClient: mockClickhouseClient,
    metadata: mockMetadata,
    state,
    template: null,
    title: 'Test Alert Title',
    view,
    teamWebhooksById: new Map(),
  });

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

          const result = await renderAlertTemplate({
            alertProvider,
            clickhouseClient: maliciousClickhouseClient,
            metadata: mockMetadata,
            state: AlertState.ALERT,
            template: null,
            title: 'Test Alert Title',
            view: makeSearchView(),
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

// Enriched alert fields (alertId, status, sourceQuery, ...) render into a
// webhook body. Claude no longer uses templated bodies (it starts an agent
// session in-process — see anthropicAgents.test.ts), but these fields remain
// available to Generic webhooks, which this covers.
describe('enriched webhook payload fields', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, text: async () => '' } as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('substitutes enriched fields into the webhook body', async () => {
    const webhookId = 'wh-claude-1';
    const view = makeSearchView({
      thresholdType: AlertThresholdType.ABOVE,
      threshold: 5,
      value: 10,
    });
    view.alert.id = 'alert-xyz';
    view.alert.note = 'Runbook: https://wiki.example.com/runbook';
    view.alert.channel = { type: 'webhook', webhookId };

    const webhook = {
      _id: new mongoose.Types.ObjectId(),
      name: 'enriched-receiver',
      service: WebhookService.Generic,
      url: 'https://receiver.example.com/hook',
      body: JSON.stringify({
        alert_id: '{{alertId}}',
        status: '{{status}}',
        type: '{{alertType}}',
        comparator: '{{comparator}}',
        threshold: '{{threshold}}',
        current_value: '{{value}}',
        team_id: '{{teamId}}',
        source_query: '{{sourceQuery}}',
        runbook: '{{note}}',
      }),
    } as any;

    await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.ALERT,
      template: null,
      title: 'Test Alert Title',
      view,
      teamWebhooksById: new Map([[webhookId, webhook]]),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(sentBody).toMatchObject({
      alert_id: 'alert-xyz',
      status: 'firing',
      type: 'search',
      comparator: '>=',
      threshold: '5',
      current_value: '10',
      team_id: 'team-123',
      source_query: 'Body: "error"', // quotes survived JSON escaping
      runbook: 'Runbook: https://wiki.example.com/runbook',
    });
  });

  it('maps resolved state to status "resolved"', async () => {
    const webhookId = 'wh-claude-2';
    const view = makeSearchView({ value: 3 });
    view.alert.channel = { type: 'webhook', webhookId };

    const webhook = {
      _id: new mongoose.Types.ObjectId(),
      name: 'enriched-receiver',
      service: WebhookService.Generic,
      url: 'https://receiver.example.com/hook',
      body: JSON.stringify({ status: '{{status}}' }),
    } as any;

    await renderAlertTemplate({
      alertProvider,
      clickhouseClient: mockClickhouseClient,
      metadata: mockMetadata,
      state: AlertState.OK,
      template: null,
      title: 'Test Alert Title',
      view,
      teamWebhooksById: new Map([[webhookId, webhook]]),
    });

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(sentBody.status).toBe('resolved');
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

describe('buildAgentPrompt', () => {
  it('serializes the firing alert into the agent-ready JSON schema', () => {
    const message = {
      hdxLink: 'http://localhost/search/abc',
      title: 'Trace Error',
      body: '80 lines found',
      startTime: Date.parse('2026-06-30T09:15:00.000Z'),
      endTime: Date.parse('2026-06-30T09:20:00.000Z'),
      eventId: 'evt-1',
      alertId: 'alert-1',
      status: 'firing',
      alertType: 'search',
      comparator: '>=',
      threshold: 1,
      value: 80,
      groupKey: 'us-east-1',
      sourceQuery: 'StatusCode:"Error"',
      note: 'Runbook: https://wiki/runbook',
      teamId: 'team-123',
    };

    const payload = JSON.parse(buildAgentPrompt(message as any));

    expect(payload.source).toBe('clickstack');
    expect(payload.schema_version).toBe('1');
    expect(typeof payload.prompt).toBe('string');
    expect(payload.alert).toMatchObject({
      id: 'alert-1',
      event_id: 'evt-1',
      status: 'firing',
      type: 'search',
      title: 'Trace Error',
      link: 'http://localhost/search/abc',
    });
    expect(payload.condition).toEqual({
      comparator: '>=',
      threshold: 1,
      current_value: 80,
    });
    expect(payload.context.source_query).toBe('StatusCode:"Error"');
    expect(payload.context.runbook).toBe('Runbook: https://wiki/runbook');
    expect(payload.context.time_range).toEqual({
      start: '2026-06-30T09:15:00.000Z',
      end: '2026-06-30T09:20:00.000Z',
    });
    // Team id is included for multitenant routing/correlation downstream.
    expect(payload.context.team_id).toBe('team-123');
  });
});

describe('handleStartAgentSession', () => {
  it('skips (no session) on a non-firing status, before the teamId/url guards', async () => {
    // status 'resolved' must return early — otherwise the missing teamId would
    // throw. Resolving cleanly proves the firing-only guard short-circuited.
    await expect(
      handleStartAgentSession(
        {
          url: 'https://hooks.slack.com/services/T/B/X',
          service: WebhookService.Claude,
        } as any,
        { status: 'resolved' } as any,
      ),
    ).resolves.toBeUndefined();
  });
});
