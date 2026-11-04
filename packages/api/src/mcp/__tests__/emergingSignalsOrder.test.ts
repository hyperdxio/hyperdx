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
};

async function run(
  baselineRows: string[],
  currentRows: string[],
  slowWindow: 'baseline' | 'current' = 'baseline',
): Promise<{ emerging: Pattern[]; disappeared: Pattern[] }> {
  mockFetchWindowSample.mockImplementation(
    async (
      _teamId: string,
      _sourceId: string,
      startDate: Date,
      endDate: Date,
      options?: { endExclusive?: boolean },
    ) => {
      const isBaseline = options?.endExclusive === true;
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
    currentStartTime: '2026-11-04T00:00:00Z',
    currentEndTime: '2026-11-05T00:00:00Z',
    baselineStartTime: '2026-11-03T00:00:00Z',
    baselineEndTime: '2026-11-04T00:00:00Z',
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

  it('fetches the baseline as a half-open window', async () => {
    await run(['a'], ['b'], 'current');
    const baselineCall = mockFetchWindowSample.mock.calls.find(
      call => call[4]?.endExclusive === true,
    );
    expect(baselineCall?.[3]).toEqual(new Date('2026-11-04T00:00:00Z'));
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

  it('reports a token that was constant in the baseline and changed now', async () => {
    // A different account in the same message is a real change: one
    // new_variant entry instead of a "new" + "gone" pair.
    const out = await run(
      lines('2026-11-03', 'acme', 20),
      lines('2026-11-04', 'globex', 20),
    );
    expect(out.emerging).toHaveLength(1);
    expect(out.emerging[0]).toMatchObject({
      status: 'new_variant',
      sample: expect.stringContaining('account globex'),
    });
    expect(out.disappeared).toEqual([]);
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
