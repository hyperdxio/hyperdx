import {
  AlertState,
  AlertThresholdType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { makeTile } from '@/fixtures';
import { AlertSource } from '@/models/alert';
import { loadProvider } from '@/tasks/checkAlerts/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateTitle,
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
    value?: number;
    group?: string;
  } = {},
): AlertMessageTemplateDefaultView => ({
  alert: {
    thresholdType: overrides.thresholdType ?? AlertThresholdType.ABOVE,
    threshold: overrides.threshold ?? 5,
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
    value?: number;
    group?: string;
  } = {},
): AlertMessageTemplateDefaultView => ({
  alert: {
    thresholdType: overrides.thresholdType ?? AlertThresholdType.ABOVE,
    threshold: overrides.threshold ?? 5,
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
];

describe('renderAlertTemplate', () => {
  describe('saved search alerts', () => {
    describe('ALERT state', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold alertValue=$alertValue',
        async ({ thresholdType, threshold, alertValue }) => {
          const result = await render(
            makeSearchView({ thresholdType, threshold, value: alertValue }),
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
    });

    describe('OK state (resolved)', () => {
      it.each(alertCases)(
        '$thresholdType threshold=$threshold okValue=$okValue',
        async ({ thresholdType, threshold, okValue }) => {
          const result = await render(
            makeSearchView({ thresholdType, threshold, value: okValue }),
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
        async ({ thresholdType, threshold, alertValue }) => {
          const result = await render(
            makeTileView({ thresholdType, threshold, value: alertValue }),
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
        async ({ thresholdType, threshold, okValue }) => {
          const result = await render(
            makeTileView({ thresholdType, threshold, value: okValue }),
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
        ({ thresholdType, threshold, alertValue }) => {
          const result = buildAlertMessageTemplateTitle({
            view: makeTileView({ thresholdType, threshold, value: alertValue }),
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
        ({ thresholdType, threshold, okValue }) => {
          const result = buildAlertMessageTemplateTitle({
            view: makeTileView({ thresholdType, threshold, value: okValue }),
            state: AlertState.OK,
          });
          expect(result).toMatchSnapshot();
        },
      );
    });
  });
});
