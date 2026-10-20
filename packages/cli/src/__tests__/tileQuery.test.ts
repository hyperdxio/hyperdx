import { describe, expect, it, jest } from '@jest/globals';

import type { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import { fetchTileData } from '@/shared/tileQuery';

const traceSource = {
  id: 'src-2',
  kind: 'trace',
  name: 'Traces',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  durationExpression: 'Duration',
  durationPrecision: 9,
} as unknown as SourceResponse;

const dateRange: [Date, Date] = [
  new Date('2026-10-13T00:00:00Z'),
  new Date('2026-10-13T00:02:00Z'),
];

function heatmapTile(extra: Record<string, unknown> = {}) {
  return {
    displayType: DisplayType.Heatmap,
    source: 'src-2',
    select: [{ aggFn: 'count', valueExpression: 'Duration' }],
    where: '',
    ...extra,
  } as unknown as SavedChartConfig;
}

describe('fetchTileData heatmap tiles', () => {
  it('runs a distribution heatmap through the bounds and bucket queries', async () => {
    const queryChartConfig = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ meta: [], data: [{ min: '1', max: '100' }] })
      .mockResolvedValueOnce({
        meta: [{ name: '__hdx_time_bucket', type: 'DateTime' }],
        data: [
          {
            __hdx_time_bucket: '2026-10-13T00:00:00Z',
            x_bucket: 2,
            count: '4',
          },
        ],
      });
    const result = await fetchTileData({
      clickhouseClient: {
        queryChartConfig,
      } as unknown as ProxyClickhouseClient,
      metadata: {} as never,
      config: heatmapTile(),
      source: traceSource,
      dateRange,
      granularity: '1 minute',
    });

    expect(queryChartConfig).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('heatmap');
    if (result.status !== 'heatmap') return;
    expect(result.grid?.times).toHaveLength(2);
    expect(result.grid?.cells.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('reports series heatmaps as unsupported without querying', async () => {
    const queryChartConfig = jest.fn();
    const result = await fetchTileData({
      clickhouseClient: {
        queryChartConfig,
      } as unknown as ProxyClickhouseClient,
      metadata: {} as never,
      config: heatmapTile({ heatmap: { mode: 'series' } }),
      source: traceSource,
      dateRange,
    });
    expect(result.status).toBe('unsupported');
    expect(queryChartConfig).not.toHaveBeenCalled();
  });
});
