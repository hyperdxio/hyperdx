// Unit test for the clickstack_query_tiles handler's per-tile failure
// isolation. Mocks the heavy collaborators (Mongo model, dashboard
// conversion, ClickHouse-backed runConfigTile) so we can drive the batch loop
// deterministically without any live services, then assert that a hanging /
// throwing tile becomes a status:'error' entry while the rest of the batch
// still resolves and the overall call stays non-error.

const mockRunConfigTile = jest.fn();
const mockFindOne = jest.fn();
const mockConvertToExternalDashboard = jest.fn();

jest.mock('@/mcp/tools/query/helpers', () => {
  const actual = jest.requireActual('@/mcp/tools/query/helpers');
  return {
    ...actual,
    runConfigTile: (...args: unknown[]) => mockRunConfigTile(...args),
  };
});

jest.mock('@/models/dashboard', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockFindOne(...args) },
}));

jest.mock('@/routers/external-api/v2/utils/dashboards', () => {
  const actual = jest.requireActual(
    '@/routers/external-api/v2/utils/dashboards',
  );
  return {
    ...actual,
    convertToExternalDashboard: (...args: unknown[]) =>
      mockConvertToExternalDashboard(...args),
  };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  registerQueryTiles,
  TileDeadlineError,
} from '@/mcp/tools/dashboards/queryTiles';
import type { McpContext, RegisterToolFn, ToolResult } from '@/mcp/tools/types';

type Handler = Parameters<RegisterToolFn>[2];

/**
 * Register the tool against a minimal registrar that just captures the handler,
 * so we can invoke it directly without wiring up an MCP transport. A real (but
 * unconnected) McpServer satisfies the registrar type; the handler under test
 * never touches it.
 */
function buildHandler(): Handler {
  let captured: Handler | undefined;
  const registerTool: RegisterToolFn = (_name, _config, handler) => {
    captured = handler;
  };
  const context: McpContext = { teamId: 'team-1', userId: 'user-1' };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerQueryTiles({ server, context, registerTool });
  if (!captured) throw new Error('handler was not registered');
  return captured;
}

function textOf(result: ToolResult): string {
  const item = result.content[0];
  if (!item || item.type !== 'text') {
    throw new Error('expected text content');
  }
  return item.text;
}

const okResult = {
  content: [{ type: 'text' as const, text: JSON.stringify({ result: [] }) }],
};

const tile = (id: string, name: string) => ({
  id,
  name,
  config: { displayType: 'number', sourceId: 'src-1', select: [] },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockResolvedValue({ _id: 'dash-1' });
});

describe('clickstack_query_tiles handler — per-tile failure isolation', () => {
  it('folds a thrown runConfigTile into a status:error entry while other tiles resolve', async () => {
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [tile('t1', 'Good'), tile('t2', 'Boom')],
    });
    mockRunConfigTile.mockImplementation((_team, t: { id: string }) => {
      if (t.id === 't2') {
        return Promise.reject(new Error('source lookup exploded'));
      }
      return Promise.resolve(okResult);
    });

    const handler = buildHandler();
    const result = await handler({
      dashboardId: '000000000000000000000000',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date().toISOString(),
    });

    // One tile threw, but the batch as a whole is not an error.
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.summary).toMatchObject({ total: 2, ok: 1, error: 1 });

    const good = parsed.tiles.find((t: { name: string }) => t.name === 'Good');
    const boom = parsed.tiles.find((t: { name: string }) => t.name === 'Boom');
    expect(good.status).toBe('ok');
    expect(boom.status).toBe('error');
    expect(boom.error).toContain('source lookup exploded');
  });

  it('folds a batch-deadline timeout into a status:error entry with the deadline message', async () => {
    // A tile that overran the shared wall-clock budget surfaces to the batch
    // loop as a rejected TileDeadlineError (see withDeadline). Assert the
    // handler renders it as a timed-out error while the fast tile still
    // resolves and the overall call stays non-error — without relying on
    // real-time waiting.
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [tile('t1', 'Fast'), tile('t2', 'Slow')],
    });
    mockRunConfigTile.mockImplementation((_team, t: { id: string }) => {
      if (t.id === 't2') {
        return Promise.reject(new TileDeadlineError());
      }
      return Promise.resolve(okResult);
    });

    const handler = buildHandler();
    const result = await handler({
      dashboardId: '000000000000000000000000',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date().toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.summary).toMatchObject({ total: 2, ok: 1, error: 1 });
    const slow = parsed.tiles.find((t: { name: string }) => t.name === 'Slow');
    expect(slow.status).toBe('error');
    expect(slow.error).toContain('deadline');
  });

  it('does not issue a query for tiles scheduled after the deadline has passed', async () => {
    // Concurrency is 2, so t1/t2 start immediately and t3 waits for a slot.
    // Drive Date.now so the budget is spent by the time t3 would start: its
    // task must short-circuit to a deadline error WITHOUT calling
    // runConfigTile, proving the post-deadline drain issues no ClickHouse
    // queries.
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [tile('t1', 'A'), tile('t2', 'B'), tile('t3', 'C')],
    });

    // A controllable clock. Start at a fixed base; jump far past the 60s
    // batch budget once the first two tiles have been dispatched.
    const base = 1_000_000_000_000;
    let now = base;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      mockRunConfigTile.mockImplementation((_team, t: { id: string }) => {
        // t1/t2 resolve fine; resolving t1 advances the clock past the
        // deadline so the queued t3 sees an expired budget.
        if (t.id === 't1') {
          now = base + 10 * 60_000; // 10 min later — well past the budget
        }
        return Promise.resolve(okResult);
      });

      const handler = buildHandler();
      const result = await handler({
        dashboardId: '000000000000000000000000',
        startTime: new Date(base - 60_000).toISOString(),
        endTime: new Date(base).toISOString(),
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(textOf(result));
      // t3 must be an error, and runConfigTile must never have been called
      // for it (only t1 and t2 issued queries).
      const c = parsed.tiles.find((t: { name: string }) => t.name === 'C');
      expect(c.status).toBe('error');
      expect(c.error).toContain('deadline');
      const queriedIds = mockRunConfigTile.mock.calls.map((call: unknown[]) => {
        const t = call[1];
        return t && typeof t === 'object' && 'id' in t ? t.id : undefined;
      });
      expect(queriedIds).not.toContain('t3');
    } finally {
      nowSpy.mockRestore();
    }
  });
});
