import { HyperdxApiClient } from '@/hyperdx/api';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('HyperdxApiClient', () => {
  it('reports invalid MCP content as a failed tile query', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: 'not valid JSON' }],
          },
        }),
    }) as unknown as typeof fetch;

    const result = await new HyperdxApiClient(
      'http://localhost',
    ).queryTileWithEvidence({
      accessKey: 'test-key',
      dashboardId: 'dashboard-id',
      tileId: 'tile-id',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T01:00:00.000Z',
    });

    expect(result.success).toBe(false);
    expect(result.hasData).toBe(false);
    expect(result.error).toMatch(/^Invalid MCP content:/);
  });
});
