// Unit test: emerging_signals mines both windows into one Drain tree in a
// fixed order, so the result doesn't depend on which window's query finishes
// first. Mocks fetchWindowSample, so no ClickHouse or Mongo is needed.

const mockFetchWindowSample = jest.fn();

jest.mock('@/mcp/tools/query/runEventPatterns', () => {
  const actual = jest.requireActual('@/mcp/tools/query/runEventPatterns');
  return {
    ...actual,
    fetchWindowSample: (...args: unknown[]) => mockFetchWindowSample(...args),
  };
});
jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerEmergingSignals } from '@/mcp/tools/query/emergingSignals';
import type { McpContext, RegisterToolFn, ToolResult } from '@/mcp/tools/types';

type Handler = Parameters<RegisterToolFn>[2];

function buildHandler(): Handler {
  let captured: Handler | undefined;
  const registerTool: RegisterToolFn = (_name, _config, handler) => {
    captured = handler;
  };
  const context: McpContext = { teamId: 'team-1', userId: 'user-1' };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEmergingSignals({ server, context, registerTool });
  if (!captured) throw new Error('handler was not registered');
  return captured;
}

function textOf(result: ToolResult): string {
  const item = result.content[0];
  if (!item || item.type !== 'text') throw new Error('expected text content');
  return item.text;
}

const lines = (day: string, account: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${day} 06:${String(i % 60).padStart(2, '0')}:12 ERROR Sync failed for account ${account}: HTTP 500`,
  );
const repeat = (line: string, n: number) =>
  Array.from({ length: n }, () => line);

function sample(rows: string[], startDate: Date, endDate: Date) {
  return {
    sampleRows: rows.map(body => ({
      __hdx_pattern_body: body,
      __hdx_pattern_ts: startDate.toISOString(),
    })),
    totalCount: rows.length,
    bodyColumn: 'Body',
    startDate,
    endDate,
  };
}

type Pattern = {
  pattern: string;
  status: string;
  sample: string;
  baselinePattern?: string;
  variantShare?: number;
};

const DAY_BEFORE = {
  baselineStart: '2026-11-03T00:00:00Z',
  baselineEnd: '2026-11-04T00:00:00Z',
  currentStart: '2026-11-04T00:00:00Z',
  currentEnd: '2026-11-05T00:00:00Z',
};

async function run(
  baselineRows: string[],
  currentRows: string[],
  slowWindow: 'baseline' | 'current' = 'baseline',
  windows = DAY_BEFORE,
): Promise<{ emerging: Pattern[]; disappeared: Pattern[] }> {
  mockFetchWindowSample.mockImplementation(
    async (
      _teamId: string,
      _sourceId: string,
      startDate: Date,
      endDate: Date,
    ) => {
      const isBaseline =
        startDate.getTime() === new Date(windows.baselineStart).getTime();
      if ((slowWindow === 'baseline') === isBaseline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return sample(
        isBaseline ? baselineRows : currentRows,
        startDate,
        endDate,
      );
    },
  );
  const result = await buildHandler()({
    sourceId: '000000000000000000000001',
    currentStartTime: windows.currentStart,
    currentEndTime: windows.currentEnd,
    baselineStartTime: windows.baselineStart,
    baselineEndTime: windows.baselineEnd,
    // The handler is called directly, so pass the schema defaults.
    sampleSize: 10_000,
    topN: 20,
    minShareRatio: 3,
  });
  return JSON.parse(textOf(result));
}

const allPatterns = (out: { emerging: Pattern[]; disappeared: Pattern[] }) => [
  ...out.emerging,
  ...out.disappeared,
];

describe('clickstack_emerging_signals with one Drain tree', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gives the same result whichever window query finishes first', async () => {
    // Insertion order matters here: the account is constant in the baseline
    // and different in the current window.
    const baseline = lines('2026-11-03', 'acme', 20);
    const current = lines('2026-11-04', 'globex', 20);
    const baselineLast = await run(baseline, current, 'baseline');
    const currentLast = await run(baseline, current, 'current');
    expect(baselineLast).toEqual(currentLast);
    expect(baselineLast.emerging.map(p => p.status)).toEqual(['new_variant']);
  });

  it('makes the earlier window half-open, whichever it is', async () => {
    const exclusiveEnd = () =>
      mockFetchWindowSample.mock.calls
        .filter(call => call[4]?.endExclusive === true)
        .map(call => String(call[3]?.toISOString()));
    await run(['a'], ['b'], 'current');
    expect(exclusiveEnd()).toEqual(['2026-11-04T00:00:00.000Z']);
    mockFetchWindowSample.mockClear();
    // Baseline after the current window: the current window is the earlier one.
    await run(['a'], ['b'], 'current', {
      baselineStart: '2026-11-05T00:00:00Z',
      baselineEnd: '2026-11-06T00:00:00Z',
      currentStart: '2026-11-04T00:00:00Z',
      currentEnd: '2026-11-05T00:00:00Z',
    });
    expect(exclusiveEnd()).toEqual(['2026-11-05T00:00:00.000Z']);
  });

  it('treats the same dated line in both windows as one pattern', async () => {
    const out = await run(
      [
        ...lines('2026-11-03', 'acme', 20),
        ...repeat('cache warmed in 3 regions', 10),
      ],
      [
        ...lines('2026-11-04', 'acme', 20),
        ...repeat('disk almost full on volume data', 10),
      ],
    );
    const patterns = allPatterns(out).map(p => p.pattern);
    expect(patterns.some(p => p.includes('Sync failed'))).toBe(false);
    expect(patterns).toEqual(
      expect.arrayContaining([
        expect.stringContaining('disk almost full'),
        expect.stringContaining('cache warmed'),
      ]),
    );
  });

  it('reports a new message that merged into a similar baseline pattern', async () => {
    const out = await run(repeat('user login failed: invalid password', 20), [
      ...repeat('user login failed: invalid password', 10),
      ...repeat('user login failed: account locked', 10),
    ]);
    expect(out.emerging).toEqual([
      expect.objectContaining({
        status: 'new_variant',
        baselinePattern: 'user login failed: invalid password',
        sample: 'user login failed: account locked',
      }),
    ]);
    expect(out.disappeared).toEqual([]);
  });

  it('reports a word that was constant in the baseline and changed now', async () => {
    // A different account name in the same message is a real change: the new
    // message is a new_variant, and the old one is gone.
    const out = await run(
      lines('2026-11-03', 'acme', 20),
      lines('2026-11-04', 'globex', 20),
    );
    expect(out.emerging).toEqual([
      expect.objectContaining({
        status: 'new_variant',
        sample: expect.stringContaining('account globex'),
      }),
    ]);
    expect(out.disappeared).toEqual([
      expect.objectContaining({
        status: 'gone',
        sample: expect.stringContaining('account acme'),
      }),
    ]);
  });

  it('reports new values of a field that had one value in the baseline', async () => {
    // Twenty baseline rows all said host=db-1, so new hosts are a real change.
    const out = await run(
      repeat('connect failed host=db-1 retry later', 20),
      Array.from(
        { length: 20 },
        (_, i) => `connect failed host=db-${i} retry later`,
      ),
    );
    expect(out.emerging).toEqual([
      expect.objectContaining({
        status: 'new_variant',
        baselinePattern: 'connect failed host=db-1 retry later',
      }),
    ]);
  });

  it('reports a new status code in an established pattern', async () => {
    const out = await run(repeat('GET /api/cart 200', 20), [
      ...repeat('GET /api/cart 200', 14),
      ...repeat('GET /api/cart 500', 6),
    ]);
    expect(out.emerging).toEqual([
      expect.objectContaining({
        status: 'new_variant',
        sample: 'GET /api/cart 500',
        variantShare: 0.3,
      }),
    ]);
    expect(out.disappeared).toEqual([]);
  });

  it('gives one cluster at most one emerging entry', async () => {
    // The baseline message also triples while a variant appears: only the
    // variant is listed in emerging.
    const out = await run(
      [
        ...repeat('user login failed: invalid password', 10),
        ...repeat('cache warmed in 3 regions', 90),
      ],
      [
        ...repeat('user login failed: invalid password', 30),
        ...repeat('user login failed: account locked', 10),
        ...repeat('cache warmed in 3 regions', 60),
      ],
    );
    const login = out.emerging.filter(p => p.pattern.startsWith('user login'));
    expect(login).toEqual([expect.objectContaining({ status: 'new_variant' })]);
  });

  it('treats klog and Spark dated lines on two days as one pattern', async () => {
    const out = await run(
      [
        ...repeat('I1103 06:12:12.345678 1 main.go:42] sync ok', 20),
        ...repeat('26/11/03 06:12:12 INFO Executor: task done', 20),
      ],
      [
        ...repeat('I1104 06:12:12.345678 1 main.go:42] sync ok', 20),
        ...repeat('26/11/04 06:12:12 INFO Executor: task done', 20),
      ],
    );
    expect(out.emerging).toEqual([]);
    expect(out.disappeared).toEqual([]);
  });

  it('does not report a one-row baseline pattern whose number changed', async () => {
    const out = await run(
      ['request took 123 ms', ...repeat('cache warmed in 3 regions', 19)],
      [
        'request took 456 ms',
        'request took 789 ms',
        ...repeat('cache warmed in 3 regions', 18),
      ],
    );
    expect(out.emerging).toEqual([]);
    expect(out.disappeared).toEqual([]);
  });

  it('reports the old message as disappeared when a variant replaced it', async () => {
    const out = await run(repeat('user login failed: invalid password', 20), [
      ...repeat('user login failed: account locked', 10),
      ...repeat('cache warmed in 3 regions', 10),
    ]);
    expect(out.emerging).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'new_variant',
          sample: 'user login failed: account locked',
        }),
      ]),
    );
    expect(out.disappeared).toEqual([
      expect.objectContaining({
        status: 'gone',
        pattern: 'user login failed: invalid password',
        sample: 'user login failed: invalid password',
      }),
    ]);
  });

  it('treats ctime-style dated lines on two days as one pattern', async () => {
    const out = await run(
      repeat('Tue Nov  3 06:12:12 2026 job finished state ok', 20),
      repeat('Wed Nov  4 06:12:12 2026 job finished state ok', 20),
    );
    expect(out.emerging).toEqual([]);
    expect(out.disappeared).toEqual([]);
  });

  it('counts only the rows Drain put in the cluster', async () => {
    // The longer line shares the prefix but has more tokens, so Drain keeps it
    // in its own cluster: it is a new pattern, not part of the variant.
    const out = await run(repeat('user login failed: invalid password', 20), [
      ...repeat('user login failed: invalid password', 10),
      ...repeat('user login failed: account locked', 10),
      ...repeat('user login failed: token expired for tenant 42', 10),
    ]);
    const variant = out.emerging.find(p => p.status === 'new_variant');
    expect(variant).toMatchObject({
      baselinePattern: 'user login failed: invalid password',
      sample: 'user login failed: account locked',
      variantShare: 0.3333,
    });
    expect(out.emerging).toContainEqual(
      expect.objectContaining({
        status: 'new',
        pattern: expect.stringContaining('token expired for tenant'),
      }),
    );
  });

  it('does not report lines that fit a template the baseline generalized', async () => {
    const out = await run(
      [
        ...repeat('job alpha finished ok', 10),
        ...repeat('job beta finished ok', 10),
      ],
      repeat('job gamma finished ok', 20),
    );
    expect(out.emerging).toEqual([]);
    expect(out.disappeared).toEqual([]);
  });

  it('labels a disappeared pattern by its shift, not new_variant', async () => {
    // One sampled variant row is below the new-pattern floor, so the old
    // pattern is simply rarer now.
    const out = await run(repeat('user login failed: invalid password', 20), [
      'user login failed: account locked',
      ...repeat('cache warmed in 3 regions', 19),
    ]);
    expect(out.disappeared).toEqual([
      expect.objectContaining({ status: 'shifted' }),
    ]);
    expect(out.disappeared[0]).not.toHaveProperty('baselinePattern');
    expect(allPatterns(out).some(p => p.status === 'new_variant')).toBe(false);
  });

  it('handles an empty window on either side', async () => {
    const rows = repeat('user login failed: invalid password', 10);
    const noCurrent = await run(rows, []);
    expect(noCurrent.emerging).toEqual([]);
    expect(noCurrent.disappeared.map(p => p.status)).toEqual(['gone']);
    const noBaseline = await run([], rows);
    expect(noBaseline.emerging.map(p => p.status)).toEqual(['new']);
    expect(noBaseline.disappeared).toEqual([]);
  });

  it('reports nothing for identical windows', async () => {
    const rows = [
      ...repeat('user login failed: invalid password', 10),
      ...repeat('cache warmed in 3 regions', 10),
    ];
    const out = await run(rows, rows);
    expect(out.emerging).toEqual([]);
    expect(out.disappeared).toEqual([]);
  });
});
