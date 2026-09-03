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
  TILE_QUERY_CONCURRENCY,
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

  it('does not issue a query for tiles scheduled after the deadline has passed', async () => {
    // Fill every concurrency slot with an initial batch of tiles, plus one
    // extra ("Overflow") that must wait for a slot. Drive Date.now so the
    // budget is spent by the time the overflow tile would start: its task must
    // short-circuit to a deadline error WITHOUT calling runConfigTile, proving
    // the post-deadline drain issues no ClickHouse queries. Deriving the tile
    // count from TILE_QUERY_CONCURRENCY keeps this correct if the constant
    // changes.
    const initialTiles = Array.from(
      { length: TILE_QUERY_CONCURRENCY },
      (_, i) => tile(`t${i}`, `Slot ${i}`),
    );
    const overflowTile = tile('overflow', 'Overflow');
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [...initialTiles, overflowTile],
    });

    // A controllable clock. Start at a fixed base; jump far past the 60s
    // batch budget once the first slot's worth of tiles have been dispatched.
    const base = 1_000_000_000_000;
    let now = base;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      mockRunConfigTile.mockImplementation((_team, t: { id: string }) => {
        // The initial tiles resolve fine; resolving the first one advances the
        // clock past the deadline so the queued overflow tile sees an expired
        // budget.
        if (t.id === 't0') {
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
      // The overflow tile must be an error, and runConfigTile must never have
      // been called for it (only the initial slot tiles issued queries).
      const overflow = parsed.tiles.find(
        (t: { name: string }) => t.name === 'Overflow',
      );
      expect(overflow.status).toBe('error');
      expect(overflow.error).toContain('deadline');
      const queriedIds = mockRunConfigTile.mock.calls.map((call: unknown[]) => {
        const t = call[1];
        return t && typeof t === 'object' && 'id' in t ? t.id : undefined;
      });
      expect(queriedIds).not.toContain('overflow');
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('clickstack_query_tiles handler — dashboard variables', () => {
  const variableFilter = {
    id: 'f1',
    type: 'QUERY_EXPRESSION',
    name: 'Service',
    expression: 'ServiceName',
    sourceId: 'src-1',
    whereLanguage: 'sql',
    isBroadcastEnabled: false,
    isVariableEnabled: true,
    variableName: 'service',
  };

  it('runs every tile with the declared variables emptied by default', async () => {
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [tile('t1', 'Requests')],
      filters: [variableFilter],
    });
    mockRunConfigTile.mockResolvedValue(okResult);

    const handler = buildHandler();
    await handler({
      dashboardId: '000000000000000000000000',
    });

    expect(mockRunConfigTile).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ id: 't1' }),
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({
        variables: [{ name: 'service', expression: 'ServiceName', values: [] }],
      }),
    );
  });

  it('applies a supplied selection', async () => {
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [tile('t1', 'Requests')],
      filters: [variableFilter],
    });
    mockRunConfigTile.mockResolvedValue(okResult);

    const handler = buildHandler();
    await handler({
      dashboardId: '000000000000000000000000',
      variableValues: [{ name: 'service', values: ['checkout'] }],
    });

    expect(mockRunConfigTile).toHaveBeenCalledWith(
      'team-1',
      expect.anything(),
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({
        variables: [
          { name: 'service', expression: 'ServiceName', values: ['checkout'] },
        ],
      }),
    );
  });

  it('rejects a variableValues name the dashboard does not declare', async () => {
    mockConvertToExternalDashboard.mockReturnValue({
      id: 'dash-1',
      tiles: [tile('t1', 'Requests')],
      filters: [variableFilter],
    });

    const handler = buildHandler();
    const result = await handler({
      dashboardId: '000000000000000000000000',
      variableValues: [{ name: 'tenant', values: ['acme'] }],
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('tenant');
    // A typo must not run the query with the variable still empty and look
    // like a data problem.
    expect(mockRunConfigTile).not.toHaveBeenCalled();
  });
});
