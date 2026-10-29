import { probeMcp } from '@/harness/preflight';
import type { McpDefinition } from '@/harness/types';

const httpDef: McpDefinition = {
  type: 'http',
  url: 'http://localhost:30199/mcp',
  headers: { Authorization: 'Bearer test' },
  toolPattern: 'mcp__hyperdx__*',
  label: 'HyperDX',
};

/** Mock fetch so each queued value is returned as an SSE JSON-RPC response. */
function mockFetch(...jsonRpc: unknown[]) {
  const fn = jest.fn();
  for (const payload of jsonRpc) {
    fn.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => null },
      text: async () => `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
    });
  }
  global.fetch = fn as unknown as typeof fetch;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('probeMcp', () => {
  it('returns ok with a tool count when initialize + tools/list succeed', async () => {
    mockFetch(
      { result: {} },
      { result: { tools: [{ name: 'a' }, { name: 'b' }] } },
    );
    expect(await probeMcp('hyperdx', httpDef)).toEqual({
      mcp: 'hyperdx',
      ok: true,
      toolCount: 2,
    });
  });

  it('fails when the server is reachable but serves zero tools', async () => {
    mockFetch({ result: {} }, { result: { tools: [] } });
    const res = await probeMcp('hyperdx', httpDef);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/0 tools/);
  });

  it('fails with an actionable message when the connection is refused', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('fetch failed'),
      ) as unknown as typeof fetch;
    const res = await probeMcp('hyperdx', httpDef);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not connect.*API server/s);
  });

  it('treats stdio MCPs as ok without probing', async () => {
    const stdioDef: McpDefinition = {
      type: 'stdio',
      command: 'uvx',
      toolPattern: 'mcp__clickhouse__*',
      label: 'ClickHouse',
    };
    expect(await probeMcp('clickhouse', stdioDef)).toEqual({
      mcp: 'clickhouse',
      ok: true,
    });
  });
});
