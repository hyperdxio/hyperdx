import { resolveComparison } from '@/mcp/tools/query/serviceHealth/comparison';
import { findNewOperations } from '@/mcp/tools/query/serviceHealth/operations';
import type { QueryContext } from '@/mcp/tools/query/serviceHealth/queries';
import { fetchServiceStats } from '@/mcp/tools/query/serviceHealth/queries';
import { comparisonWindow } from '@/mcp/tools/query/serviceHealth/schema';

jest.mock('@/mcp/tools/query/serviceHealth/queries', () => ({
  ...jest.requireActual('@/mcp/tools/query/serviceHealth/queries'),
  fetchServiceStats: jest.fn(),
}));

const fetchStats = jest.mocked(fetchServiceStats);

const current = {
  start: new Date('2026-10-16T10:00:00Z'),
  end: new Date('2026-10-16T11:00:00Z'),
};
const yesterday = comparisonWindow(current, 'yesterday');
const stats = (services: string[]) => ({
  stats: new Map(
    services.map(s => [
      s,
      { requests: 100, errors: 0, p50Ms: 1, p95Ms: 2, p99Ms: 3 },
    ]),
  ),
  mvUsed: false,
});

const source = {
  id: 'src',
  connection: 'conn',
  from: { databaseName: 'db', tableName: 't' },
  timestampValueExpression: 'Timestamp',
  serviceNameExpression: 'ServiceName',
  statusCodeExpression: 'StatusCode',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  durationExpression: 'Duration',
  durationPrecision: 9,
  querySettings: undefined,
  mvSource: undefined,
};

const ctxWith = (queryChartConfig: jest.Mock): QueryContext =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test double with only the members the code under test reads
  ({
    client: { queryChartConfig },
    metadata: {},
    source,
    input: { spanKind: 'server', where: '', whereLanguage: 'lucene' },
    signal: new AbortController().signal,
  }) as unknown as QueryContext;

describe('resolveComparison', () => {
  beforeEach(() => fetchStats.mockReset());

  it('keeps the requested window when it has data', async () => {
    const r = await resolveComparison(ctxWith(jest.fn()), {
      current,
      requested: yesterday,
      requestedMode: 'yesterday',
      curHasData: true,
      requestedCmp: stats(['a']),
    });
    expect(r.comparisonMode).toBe('yesterday');
    expect(r.comparisonNote).toBeUndefined();
    expect(fetchStats).not.toHaveBeenCalled();
  });

  it('falls back to the previous period when the requested window is empty', async () => {
    fetchStats.mockResolvedValue(stats(['a']));
    const r = await resolveComparison(ctxWith(jest.fn()), {
      current,
      requested: yesterday,
      requestedMode: 'yesterday',
      curHasData: true,
      requestedCmp: stats([]),
    });
    expect(r.comparisonMode).toBe('previous_period');
    expect(r.comparison?.end.toISOString()).toBe(current.start.toISOString());
    expect(r.comparisonNote).toMatch(/previous period/);
  });

  it('drops the comparison when the previous period is empty too', async () => {
    fetchStats.mockResolvedValue(stats([]));
    const r = await resolveComparison(ctxWith(jest.fn()), {
      current,
      requested: yesterday,
      requestedMode: 'yesterday',
      curHasData: true,
      requestedCmp: stats([]),
    });
    expect(r).toMatchObject({
      comparison: null,
      cmp: null,
      comparisonMode: 'none',
    });
    expect(r.comparisonNote).toMatch(/nothing is labelled new/);
  });
});

describe('findNewOperations', () => {
  const row = (service: string, op: string, requests: number) => ({
    __hdx_service: service,
    __hdx_operation: op,
    requests,
  });

  it('reports operations with no prior traffic', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        data: [row('svc', 'GET /old', 900), row('svc', 'GET /new', 100)],
      })
      .mockResolvedValueOnce({ data: [row('svc', 'GET /old', 900)] });
    const r = await findNewOperations(
      ctxWith(query),
      current,
      yesterday!,
      ['svc'],
      50,
    );
    expect(r.complete).toBe(true);
    expect(r.newOperations.get('svc')).toEqual([
      { operation: 'GET /new', requests: 100, shareOfService: 0.1 },
    ]);
  });

  it('reports nothing when a result is truncated', async () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      row('svc', `op${i}`, 20),
    );
    const query = jest
      .fn()
      .mockResolvedValueOnce({ data: many })
      .mockResolvedValueOnce({ data: [row('svc', 'op0', 900)] });
    const r = await findNewOperations(
      ctxWith(query),
      current,
      yesterday!,
      ['svc'],
      50,
    );
    expect(r.complete).toBe(false);
    expect(r.newOperations.size).toBe(0);
  });
});
