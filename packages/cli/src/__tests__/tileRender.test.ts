import { describe, expect, it } from '@jest/globals';

import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { renderTileContent } from '@/shared/tileRender';
import type { TileQueryResult } from '@/shared/tileQuery';
import { stripAnsi } from '@/termchart';

const dateRange: [Date, Date] = [
  new Date('2026-07-10T00:00:00Z'),
  new Date('2026-07-10T01:00:00Z'),
];

describe('renderTileContent', () => {
  it('throws when a line result has no timestamp column', () => {
    // Pins the contract that TileChart's try/catch (and the chart
    // command's renderOne) depend on: shaping a non-conforming result
    // throws instead of rendering garbage — callers must degrade to a
    // per-tile error.
    const result: TileQueryResult = {
      status: 'ok',
      queriedConfig: {
        displayType: DisplayType.Line,
        dateRange,
        granularity: '1 minute',
      } as unknown as ChartConfigWithDateRange,
      data: {
        meta: [
          { name: 'ServiceName', type: 'String' },
          { name: 'count()', type: 'UInt64' },
        ],
        data: [{ ServiceName: 'api', 'count()': 3 }],
        rows: 1,
      } as never,
    };

    expect(() =>
      renderTileContent({ result, source: undefined, width: 80, height: 12 }),
    ).toThrow(/No timestamp column/);
  });

  it('renders a stacked line as a stacked bar', () => {
    const render = (displayType: DisplayType) =>
      stripAnsi(
        renderTileContent({
          result: {
            status: 'ok',
            queriedConfig: {
              configType: 'sql',
              displayType,
              sqlTemplate: '',
              connection: '',
              dateRange,
              granularity: '1 minute',
            },
            data: {
              meta: [
                { name: 'ts', type: 'DateTime' },
                { name: 'ServiceName', type: 'String' },
                { name: 'count()', type: 'UInt64' },
              ],
              data: [0, 1, 2].flatMap(minute => [
                {
                  ts: `2026-07-10 00:0${minute}:00`,
                  ServiceName: 'api',
                  'count()': 100,
                },
                {
                  ts: `2026-07-10 00:0${minute}:00`,
                  ServiceName: 'web',
                  'count()': 200,
                },
              ]),
              rows: 6,
            },
          },
          source: undefined,
          width: 60,
          height: 12,
        }),
      );

    expect(render(DisplayType.StackedLine)).toBe(
      render(DisplayType.StackedBar),
    );
    expect(render(DisplayType.StackedLine)).not.toBe(render(DisplayType.Line));
  });

  it('draws a distribution heatmap with its duration axis', () => {
    const heatmapConfig = {
      displayType: DisplayType.Heatmap,
      dateRange,
      numberFormat: { output: 'duration', factor: 0.001 },
    } as unknown as ChartConfigWithDateRange;
    const result: TileQueryResult = {
      status: 'heatmap',
      queriedConfig: heatmapConfig,
      grid: {
        times: [dateRange[0].getTime(), dateRange[0].getTime() + 60_000],
        stepMs: 60_000,
        yAxis: { type: 'numeric', scale: 'log', edges: [1, 10, 100, 1000] },
        cells: [9, 1, 0, 0, 2, 30],
      },
    };
    const output = stripAnsi(
      renderTileContent({ result, source: undefined, width: 60, height: 12 }),
    );
    expect(output).toContain('events per cell, max 30');
    expect(output).toMatch(/[░▒▓█]/);

    expect(
      stripAnsi(
        renderTileContent({
          result: { ...result, grid: undefined },
          source: undefined,
          width: 60,
          height: 12,
        }),
      ),
    ).toContain('Not enough data points');
  });

  it('formats a saved Duration heatmap as durations without a numberFormat', () => {
    const result: TileQueryResult = {
      status: 'heatmap',
      queriedConfig: {
        displayType: DisplayType.Heatmap,
        dateRange,
        select: [{ aggFn: 'count', valueExpression: 'Duration' }],
      } as unknown as ChartConfigWithDateRange,
      grid: {
        times: [dateRange[0].getTime()],
        stepMs: 0,
        yAxis: { type: 'numeric', scale: 'log', edges: [1e6, 1e7, 1e8, 1e9] },
        cells: [3, 5, 1],
      },
    };
    const traceSource = {
      kind: 'trace',
      durationExpression: 'Duration',
      durationPrecision: 9,
    } as never;
    const output = stripAnsi(
      renderTileContent({ result, source: traceSource, width: 60, height: 12 }),
    );
    expect(output).toMatch(/\d+(ms|s)\b/);
    expect(output).not.toContain('1.0B');
  });
});
