import { preflightMcps, probeMcp } from '@/harness/preflight';
import type { McpDefinition } from '@/harness/types';

const httpDef = (url = 'http://localhost:30199/mcp'): McpDefinition => ({
  type: 'http',
  url,
  headers: { Authorization: 'Bearer test' },
  toolPattern: 'mcp__hyperdx__*',
  label: 'HyperDX',
});

/** Build a Response-like object for the mocked fetch. */
function sseResponse(status: number, jsonRpc: unknown): Response {
  const body = `event: message\ndata: ${JSON.stringify(jsonRpc)}\n\n`;
  return {
    status,
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

function jsonResponse(status: number, jsonRpc: unknown): Response {
  return {
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(jsonRpc),
  } as unknown as Response;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('probeMcp', () => {
  it('returns ok with a tool count when the server initializes and lists tools (SSE framing)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(sseResponse(200, { result: { serverInfo: {} } }))
      .mockResolvedValueOnce(
        sseResponse(200, {
          result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await probeMcp('hyperdx', httpDef());
    expect(res).toEqual({ mcp: 'hyperdx', ok: true, toolCount: 3 });
  });

  it('handles plain JSON (non-SSE) response bodies', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { result: {} }))
      .mockResolvedValueOnce(
        jsonResponse(200, { result: { tools: [{ name: 'a' }] } }),
      ) as unknown as typeof fetch;

    const res = await probeMcp('hyperdx', httpDef());
    expect(res.ok).toBe(true);
    expect(res.toolCount).toBe(1);
  });

  it('fails when the server is reachable but serves zero tools', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(sseResponse(200, { result: {} }))
      .mockResolvedValueOnce(
        sseResponse(200, { result: { tools: [] } }),
      ) as unknown as typeof fetch;

    const res = await probeMcp('hyperdx', httpDef());
    expect(res.ok).toBe(false);
    expect(res.toolCount).toBe(0);
    expect(res.error).toMatch(/0 tools/);
  });

  it('fails when initialize returns a non-2xx status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(sseResponse(404, {})) as unknown as typeof fetch;

    const res = await probeMcp('hyperdx', httpDef());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 404/);
  });

  it('fails with an actionable message when the connection is refused', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('fetch failed'),
      ) as unknown as typeof fetch;

    const res = await probeMcp('hyperdx', httpDef());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not connect/);
    expect(res.error).toMatch(/API server/);
  });

  it('surfaces a JSON-RPC error object from initialize', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        sseResponse(200, { error: { code: -32000, message: 'nope' } }),
      ) as unknown as typeof fetch;

    const res = await probeMcp('hyperdx', httpDef());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JSON-RPC error/);
  });

  it('treats stdio MCPs as ok without probing', async () => {
    global.fetch = jest.fn(() => {
      throw new Error('should not be called for stdio');
    }) as unknown as typeof fetch;

    const stdioDef: McpDefinition = {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-clickhouse'],
      toolPattern: 'mcp__clickhouse__*',
      label: 'ClickHouse',
    };
    const res = await probeMcp('clickhouse', stdioDef);
    expect(res).toEqual({ mcp: 'clickhouse', ok: true });
  });
});

describe('preflightMcps', () => {
  it('probes every entry and preserves order', async () => {
    // Probes run concurrently (Promise.all), so route by URL rather than by
    // call order. Slot 99 (branch) is up and serves a tool; slot 98 (main)
    // refuses the connection.
    global.fetch = jest.fn((url: string, init: { body: string }) => {
      if (url.includes('30198')) {
        return Promise.reject(new Error('fetch failed'));
      }
      const method = JSON.parse(init.body).method;
      return Promise.resolve(
        method === 'tools/list'
          ? sseResponse(200, { result: { tools: [{ name: 'x' }] } })
          : sseResponse(200, { result: {} }),
      );
    }) as unknown as typeof fetch;

    const results = await preflightMcps([
      { mcp: 'branch', def: httpDef('http://localhost:30199/mcp') },
      { mcp: 'main', def: httpDef('http://localhost:30198/mcp') },
    ]);

    expect(results.map(r => r.mcp)).toEqual(['branch', 'main']);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
  });
});
