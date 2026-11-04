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

const baselineRows = [
  ...lines('2026-11-03', 'acme', 20),
  ...Array.from({ length: 10 }, () => 'cache warmed in 3 regions'),
];
const currentRows = [
  ...lines('2026-11-04', 'globex', 20),
  ...Array.from({ length: 10 }, () => 'disk almost full on volume data'),
];

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

async function run(slowWindow: 'baseline' | 'current') {
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

describe('clickstack_emerging_signals window order', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gives the same result whichever window query finishes first', async () => {
    const baselineLast = await run('baseline');
    const currentLast = await run('current');
    expect(baselineLast).toEqual(currentLast);
  });

  it('fetches the baseline as a half-open window', async () => {
    await run('current');
    const baselineCall = mockFetchWindowSample.mock.calls.find(
      call => call[4]?.endExclusive === true,
    );
    expect(baselineCall?.[3]).toEqual(new Date('2026-11-04T00:00:00Z'));
  });

  it('treats the same dated line in both windows as one pattern', async () => {
    const out = await run('baseline');
    const all = [...out.emerging, ...out.disappeared].map(
      (p: { pattern: string }) => p.pattern,
    );
    expect(all.some(p => p.includes('Sync failed'))).toBe(false);
    expect(all).toEqual(
      expect.arrayContaining([
        expect.stringContaining('disk almost full'),
        expect.stringContaining('cache warmed'),
      ]),
    );
  });
});
