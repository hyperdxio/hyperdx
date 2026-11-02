// Drives runConfigTile inside withToolTracing to check that the source it
// resolves reaches both the tool span and the log_comment of the query it runs.

const mockToolSpan = { setAttribute: jest.fn(), setStatus: jest.fn() };
const mockQueries: { clickhouse_settings?: Record<string, unknown> }[] = [];
const mockGetSource = jest.fn();

jest.mock('@/utils/instrumentation', () => ({
  getActiveTraceId: () => 'trace-1',
  getCounter: () => ({ add: jest.fn() }),
  getHistogram: () => ({ record: jest.fn() }),
  SpanStatusCode: { OK: 1, ERROR: 2 },
  withSpan: (_name: string, fn: (span: unknown) => unknown) => fn(mockToolSpan),
}));
jest.mock('@/controllers/user', () => ({
  recordOnboardingTaskCompletion: jest.fn(),
}));
jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({
  getSource: (...args: unknown[]) => mockGetSource(...args),
}));
jest.mock('@/controllers/connection', () => ({
  getConnectionById: async () => ({
    host: 'http://localhost:8123',
    username: 'default',
    password: '',
  }),
}));
// The real node client, so log_comment comes from its own attribution logic.
// queryChartConfig is replaced with a plain query that carries no per-query
// attribution of its own, so only the ambient scope can supply the source.
jest.mock('@/clickhouse', () => {
  const { ClickhouseClient } = jest.requireActual(
    '@hyperdx/common-utils/dist/clickhouse/node',
  );
  class RecordingClient extends ClickhouseClient {
    async queryChartConfig() {
      await this.query({ query: 'SELECT 1', format: 'JSON' });
      return { data: [], meta: [], rows: 0 };
    }

    protected async __query(inputs: (typeof mockQueries)[number]) {
      mockQueries.push(inputs);
      return {};
    }
  }
  return { ClickhouseClient: RecordingClient };
});
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { buildTile, runConfigTile } from '@/mcp/tools/query/helpers';
import { withToolTracing } from '@/mcp/utils/tracing';

const context = { teamId: 'team-1', userId: 'user-1' };
const startDate = new Date('2025-01-01T00:00:00Z');
const endDate = new Date('2025-01-01T01:00:00Z');

function fakeSource(kind: SourceKind) {
  return {
    _id: new mongoose.Types.ObjectId(),
    kind,
    name: `${kind} source`,
    connection: new mongoose.Types.ObjectId(),
    from: { databaseName: 'default', tableName: `otel_${kind}` },
    timestampValueExpression: 'Timestamp',
  };
}

function logCommentOf(index: number) {
  return JSON.parse(
    String(mockQueries.at(index)?.clickhouse_settings?.log_comment),
  );
}

function attributeValues(key: string) {
  return mockToolSpan.setAttribute.mock.calls
    .filter(([k]) => k === key)
    .map(([, v]) => v);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueries.length = 0;
});

describe('MCP source attribution', () => {
  it('tags a builder tile query and the tool span with its source', async () => {
    const source = fakeSource(SourceKind.Log);
    mockGetSource.mockResolvedValue(source);
    const tile = buildTile('t', 12, 4, {
      displayType: 'table',
      sourceId: source._id.toString(),
      select: [{ aggFn: 'count' }],
    });

    const traced = withToolTracing('clickstack_table', context, () =>
      runConfigTile(context.teamId, tile, startDate, endDate),
    );
    const result = await traced({});

    expect(result.isError).toBeFalsy();
    expect(mockQueries).toHaveLength(1);
    expect(logCommentOf(0)).toEqual({
      v: 1,
      surface: 'mcp',
      source: source._id.toString(),
      trace: 'trace-1',
      label: 'clickstack_table',
    });
    expect(attributeValues('mcp.source.id')).toEqual([source._id.toString()]);
    expect(attributeValues('mcp.source.kind')).toEqual(['log']);
  });

  it('tags a raw SQL tile query with its source', async () => {
    const source = fakeSource(SourceKind.Trace);
    mockGetSource.mockResolvedValue(source);
    const tile = buildTile('t', 24, 6, {
      configType: 'sql',
      displayType: 'table',
      connectionId: source.connection.toString(),
      sourceId: source._id.toString(),
      sqlTemplate: 'SELECT 1',
    });

    const traced = withToolTracing('clickstack_sql', context, () =>
      runConfigTile(context.teamId, tile, startDate, endDate),
    );
    await traced({});

    expect(logCommentOf(0)).toMatchObject({
      surface: 'mcp',
      label: 'clickstack_sql',
      source: source._id.toString(),
    });
    expect(attributeValues('mcp.source.kind')).toEqual(['trace']);
  });

  it('leaves the source out of a raw SQL query without one', async () => {
    const tile = buildTile('t', 24, 6, {
      configType: 'sql',
      displayType: 'table',
      connectionId: new mongoose.Types.ObjectId().toString(),
      sqlTemplate: 'SELECT 1',
    });

    const traced = withToolTracing('clickstack_sql', context, () =>
      runConfigTile(context.teamId, tile, startDate, endDate),
    );
    await traced({});

    expect(mockGetSource).not.toHaveBeenCalled();
    expect(logCommentOf(0)).not.toHaveProperty('source');
    expect(logCommentOf(0)).toMatchObject({ label: 'clickstack_sql' });
    expect(attributeValues('mcp.source.id')).toEqual([]);
  });

  it('tags each tile with its own source and lists all on the span', async () => {
    const logSource = fakeSource(SourceKind.Log);
    const traceSource = fakeSource(SourceKind.Trace);
    mockGetSource.mockImplementation(async (_team: string, id: string) =>
      [logSource, traceSource].find(s => s._id.toString() === id),
    );
    const tileFor = (source: ReturnType<typeof fakeSource>) =>
      buildTile('t', 12, 4, {
        displayType: 'table',
        sourceId: source._id.toString(),
        select: [{ aggFn: 'count' }],
      });

    const traced = withToolTracing('clickstack_query_tiles', context, () =>
      Promise.all([
        runConfigTile(context.teamId, tileFor(logSource), startDate, endDate),
        runConfigTile(context.teamId, tileFor(traceSource), startDate, endDate),
      ]).then(([first]) => first),
    );
    await traced({});

    expect(mockQueries.map((_, i) => logCommentOf(i).source).sort()).toEqual(
      [logSource._id.toString(), traceSource._id.toString()].sort(),
    );
    expect(attributeValues('mcp.source.ids').at(-1)).toEqual(
      expect.arrayContaining([
        logSource._id.toString(),
        traceSource._id.toString(),
      ]),
    );
    expect(attributeValues('mcp.source.id')).toHaveLength(1);
  });
});
