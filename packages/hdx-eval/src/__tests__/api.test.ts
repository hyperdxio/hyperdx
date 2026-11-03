import { HyperdxApiClient } from '@/hyperdx/api';

const originalFetch = global.fetch;

function mockMcpContent(text: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text }],
        },
      }),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('HyperdxApiClient', () => {
  it('reports invalid MCP content as a failed tile query', async () => {
    mockMcpContent('not valid JSON');

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

  it('treats empty MCP content as a successful query with no data', async () => {
    mockMcpContent(' \n');

    const result = await new HyperdxApiClient(
      'http://localhost',
    ).queryTileWithEvidence({
      accessKey: 'test-key',
      dashboardId: 'dashboard-id',
      tileId: 'tile-id',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T01:00:00.000Z',
    });

    expect(result).toEqual({ success: true, hasData: false });
  });

  it('extracts rows and groups from valid MCP content', async () => {
    mockMcpContent(
      JSON.stringify({
        result: [
          { ServiceName: 'api', value: 1 },
          { ServiceName: 'worker', value: 2 },
        ],
      }),
    );

    const result = await new HyperdxApiClient(
      'http://localhost',
    ).queryTileWithEvidence({
      accessKey: 'test-key',
      dashboardId: 'dashboard-id',
      tileId: 'tile-id',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T01:00:00.000Z',
    });

    expect(result).toEqual({
      success: true,
      hasData: true,
      rowCount: 2,
      groupCount: 2,
      sampleRows: [
        { ServiceName: 'api', value: 1 },
        { ServiceName: 'worker', value: 2 },
      ],
    });
  });

  it('treats valid MCP content without a result as no data', async () => {
    mockMcpContent('{}');

    const result = await new HyperdxApiClient(
      'http://localhost',
    ).queryTileWithEvidence({
      accessKey: 'test-key',
      dashboardId: 'dashboard-id',
      tileId: 'tile-id',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T01:00:00.000Z',
    });

    expect(result).toEqual({ success: true, hasData: false });
  });
});
