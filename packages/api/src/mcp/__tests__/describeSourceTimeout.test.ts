const mockMetadata = {
  getColumns: jest.fn(),
  getMapKeys: jest.fn(),
  getAllKeyValues: jest.fn(),
};

jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({ getSource: jest.fn() }));
jest.mock('@/controllers/connection', () => ({
  getConnectionById: jest.fn(),
}));
jest.mock('@/clickhouse', () => ({ ClickhouseClient: jest.fn() }));
jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
  getMetadata: () => mockMetadata,
}));
jest.mock('@/utils/trimToolResponse', () => ({
  trimToolResponse: (data: unknown) => ({ data, isTrimmed: false }),
}));

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  DESCRIBE_BACKSTOP_MS,
  DESCRIBE_TIMEOUT_MS,
  registerDescribeSource,
} from '@/mcp/tools/sources/describeSource';
import type { ToolRegistrar, ToolResult } from '@/mcp/tools/types';

const COLUMNS = [
  { name: 'Timestamp', type: 'DateTime64(9)' },
  { name: 'ServiceName', type: 'LowCardinality(String)' },
  { name: 'SpanAttributes', type: 'Map(LowCardinality(String), String)' },
];

const traceSource = {
  _id: 'source-1',
  name: 'Traces',
  kind: SourceKind.Trace,
  connection: 'conn-1',
  timestampValueExpression: 'Timestamp',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  toObject() {
    return { ...this };
  },
};

const never = () => new Promise<never>(() => {});

const rejectOnAbort = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

function getHandler() {
  let handler: ((args: { sourceId: string }) => Promise<ToolResult>) | null =
    null;
  registerDescribeSource({
    server: {},
    context: { teamId: 'team-1', userId: 'user-1' },
    registerTool: (_name: string, _config: unknown, h: typeof handler) => {
      handler = h;
    },
  } as unknown as ToolRegistrar);
  return handler!;
}

async function runWithClock(advanceMs: number) {
  const pending = getHandler()({ sourceId: 'source-1' });
  await jest.advanceTimersByTimeAsync(advanceMs);
  return pending;
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text);

describe('clickstack_describe_source deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest
      .mocked(getSource)
      .mockResolvedValue(
        traceSource as unknown as Awaited<ReturnType<typeof getSource>>,
      );
    jest.mocked(getConnectionById).mockResolvedValue({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
    } as unknown as Awaited<ReturnType<typeof getConnectionById>>);
    mockMetadata.getColumns.mockResolvedValue(COLUMNS);
    mockMetadata.getMapKeys.mockResolvedValue(['http.method']);
    mockMetadata.getAllKeyValues.mockResolvedValue([
      { key: 'ServiceName', value: ['api'] },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('returns a complete result when discovery finishes before the deadline', async () => {
    const result = await runWithClock(0);

    expect(result.isError).toBeFalsy();
    const { source } = parse(result);
    expect(source.columns).toHaveLength(COLUMNS.length);
    expect(source.mapAttributeKeys).toEqual({
      SpanAttributes: ['http.method'],
    });
    expect(source.partial).toBeUndefined();
    expect(source.skippedStages).toBeUndefined();
  });

  it('returns columns with skippedStages when sampling is aborted at the deadline', async () => {
    mockMetadata.getMapKeys.mockImplementation(({ signal }) =>
      rejectOnAbort(signal),
    );

    const result = await runWithClock(DESCRIBE_TIMEOUT_MS);

    expect(result.isError).toBeFalsy();
    const { source, usage } = parse(result);
    expect(source.columns).toHaveLength(COLUMNS.length);
    expect(source.partial).toBe(true);
    expect(source.skippedStages).toEqual([
      'mapAttributeKeys',
      'lowCardinalityValues',
    ]);
    expect(usage.lowCardinalityValues).toContain('skipped due to timeout');
  });

  it('keeps stages that finished before the deadline', async () => {
    mockMetadata.getAllKeyValues.mockImplementation(({ signal }) =>
      rejectOnAbort(signal),
    );

    const { source } = parse(await runWithClock(DESCRIBE_TIMEOUT_MS));

    expect(source.mapAttributeKeys).toEqual({
      SpanAttributes: ['http.method'],
    });
    expect(source.partial).toBe(true);
    expect(source.skippedStages).toEqual([
      'lowCardinalityValues',
      'mapAttributeValues',
    ]);
  });

  it('answers from the snapshot at the backstop when a call ignores the signal', async () => {
    mockMetadata.getMapKeys.mockImplementation(never);
    const handler = getHandler();
    let settled = false;
    const pending = handler({ sourceId: 'source-1' }).finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(DESCRIBE_TIMEOUT_MS);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(DESCRIBE_BACKSTOP_MS);

    const result = await pending;
    expect(result.isError).toBeFalsy();
    const { source } = parse(result);
    expect(source.columns).toHaveLength(COLUMNS.length);
    expect(source.partial).toBe(true);
    expect(source.skippedStages).toEqual([
      'mapAttributeKeys',
      'lowCardinalityValues',
      'mapAttributeValues',
    ]);
  });

  it('returns the timeout error only when the column schema never loads', async () => {
    mockMetadata.getColumns.mockImplementation(never);

    const result = await runWithClock(
      DESCRIBE_TIMEOUT_MS + DESCRIBE_BACKSTOP_MS,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Schema discovery timed out');
  });
});
