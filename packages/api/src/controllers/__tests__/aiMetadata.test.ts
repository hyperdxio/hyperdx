const mockGetAllFields = jest.fn(
  async (_opts: {
    dateRange: [Date, Date];
    timestampValueExpression?: string;
    metadataMVs?: MetadataMaterializedViews;
  }): Promise<{ path: string[]; type: string }[]> => [],
);
const mockGetTableMetadata = jest.fn(async () => ({ primary_key: '' }));
const mockGetKeyValues = jest.fn(async () => []);

jest.mock('@/controllers/connection', () => ({
  getConnectionById: jest.fn(async () => ({
    host: 'http://localhost:8123',
    username: 'default',
    password: '',
  })),
}));

jest.mock('@/clickhouse', () => ({
  ClickhouseClient: jest.fn(() => ({})),
}));

jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
  ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
  getMetadata: () => ({
    getAllFields: mockGetAllFields,
    getTableMetadata: mockGetTableMetadata,
    getKeyValues: mockGetKeyValues,
  }),
}));

import {
  MetadataMaterializedViews,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';

import { getAIMetadata } from '@/controllers/ai';
import type { ISource } from '@/models/source';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAIMetadata', () => {
  it('bounds field discovery to a 24h window', async () => {
    const source: ISource = {
      id: 'source-1',
      name: 'Logs',
      kind: SourceKind.Log,
      team: '65f1c2d3e4b5a67890123456',
      connection: '65f1c2d3e4b5a67890123457',
      from: { databaseName: 'otel', tableName: 'otel_logs' },
      timestampValueExpression: 'TimestampTime',
      defaultTableSelectExpression: 'Body',
      metadataMaterializedViews: {
        kvRollupTable: 'otel_logs_kv_rollup_15m',
        granularity: '15 minute',
      },
    };

    await getAIMetadata(source);

    const { dateRange, timestampValueExpression, metadataMVs } =
      mockGetAllFields.mock.calls[0][0];
    const HOUR = 60 * 60 * 1000;
    expect(timestampValueExpression).toBe('TimestampTime');
    expect(metadataMVs).toEqual(source.metadataMaterializedViews);
    expect(
      dateRange[1].getTime() - dateRange[0].getTime(),
    ).toBeGreaterThanOrEqual(24 * HOUR);
    expect(dateRange[0].getTime() % HOUR).toBe(0);
    expect(dateRange[1].getTime() % HOUR).toBe(0);
  });
});
