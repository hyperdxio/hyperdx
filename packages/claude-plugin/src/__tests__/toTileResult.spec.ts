import { describe, expect, it } from '@jest/globals';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { chartedTool, parseResponse, toTileResult } from '../toTileResult';

const response = {
  meta: [
    { name: 'Spans', type: 'UInt64' },
    { name: '__hdx_time_bucket', type: 'DateTime' },
  ],
  data: [
    { Spans: '1', __hdx_time_bucket: '2026-10-13T00:00:00Z' },
    { Spans: '4', __hdx_time_bucket: '2026-10-13T00:05:00Z' },
  ],
};
const output = [
  {
    type: 'text',
    text: JSON.stringify({ result: response, notebookUrl: 'x' }),
  },
];
const calledAt = Date.parse('2026-10-13T01:00:00Z');

describe('chartedTool', () => {
  it('matches the builder tools whatever the MCP server is named', () => {
    expect(chartedTool('mcp__clickstack__clickstack_timeseries')).toBe(
      'clickstack_timeseries',
    );
    expect(chartedTool('mcp__my-hdx__clickstack_table')).toBe(
      'clickstack_table',
    );
    expect(chartedTool('mcp__clickstack__clickstack_search')).toBeUndefined();
  });
});

describe('parseResponse', () => {
  it('reads the result from MCP text blocks', () => {
    expect(parseResponse(output)).toEqual(response);
    expect(parseResponse({ content: output })).toEqual(response);
  });

  it('ignores errors and non-JSON output', () => {
    expect(
      parseResponse([{ type: 'text', text: 'Error: bad query' }]),
    ).toBeUndefined();
    expect(parseResponse('not blocks')).toBeUndefined();
  });
});

describe('toTileResult', () => {
  it('maps the tool shape to a display type and keeps the requested window', () => {
    const result = toTileResult(
      'mcp__clickstack__clickstack_timeseries',
      {
        shape: 'stacked_bar',
        granularity: '5 minute',
        startTime: '2026-10-13T00:00:00Z',
        endTime: '2026-10-13T00:10:00Z',
      },
      output,
      calledAt,
    );
    expect(result?.queriedConfig).toMatchObject({
      displayType: DisplayType.StackedBar,
      granularity: '5 minute',
      dateRange: [
        new Date('2026-10-13T00:00:00Z'),
        new Date('2026-10-13T00:10:00Z'),
      ],
    });
  });

  it('defaults to the server defaults: line, the last 15 minutes, inferred buckets', () => {
    const result = toTileResult(
      'mcp__clickstack__clickstack_timeseries',
      {},
      output,
      calledAt,
    );
    expect(result?.queriedConfig).toMatchObject({
      displayType: DisplayType.Line,
      granularity: '300 second',
      dateRange: [new Date('2026-10-13T00:45:00Z'), new Date(calledAt)],
    });
  });

  it('does not fill empty buckets when the bucket size is unknown', () => {
    const single = [
      {
        type: 'text',
        text: JSON.stringify({
          result: { ...response, data: response.data.slice(0, 1) },
        }),
      },
    ];
    const result = toTileResult(
      'mcp__clickstack__clickstack_timeseries',
      {},
      single,
      calledAt,
    );
    expect(result?.queriedConfig).toMatchObject({
      granularity: undefined,
      fillNulls: false,
    });
  });

  it('skips empty results and shapes it does not know', () => {
    const empty = [
      {
        type: 'text',
        text: JSON.stringify({ result: { ...response, data: [] } }),
      },
    ];
    expect(
      toTileResult(
        'mcp__clickstack__clickstack_timeseries',
        {},
        empty,
        calledAt,
      ),
    ).toBeUndefined();
    expect(
      toTileResult(
        'mcp__clickstack__clickstack_table',
        { shape: 'heatmap' },
        output,
        calledAt,
      ),
    ).toBeUndefined();
  });

  it('turns a heatmap result into a grid, for the heatmap and query_tile tools', () => {
    const heatmap = {
      scale: 'log',
      numberFormat: { output: 'duration', factor: 1e-9 },
      times: ['2026-10-13T00:00:00.000Z', '2026-10-13T00:01:00.000Z'],
      valueEdges: [1, 10, 100],
      counts: [
        [0, 3, 0, 0],
        [0, 1, 2, 0],
      ],
    };
    const out = [{ type: 'text', text: JSON.stringify({ heatmap }) }];
    for (const tool of ['clickstack_heatmap', 'clickstack_query_tile']) {
      const result = toTileResult(
        `mcp__clickstack__${tool}`,
        {},
        out,
        calledAt,
      );
      expect(result).toMatchObject({
        status: 'heatmap',
        queriedConfig: {
          displayType: DisplayType.Heatmap,
          numberFormat: heatmap.numberFormat,
        },
        grid: {
          stepMs: 60_000,
          // Under- and overflow rows get one bucket's height on either side.
          yAxis: {
            type: 'numeric',
            scale: 'log',
            edges: [0.1, 1, 10, 100, 1000],
          },
          cells: [0, 3, 0, 0, 0, 1, 2, 0],
        },
      });
    }
  });

  it('leaves a query_tile result alone unless it is a heatmap', () => {
    expect(
      toTileResult(
        'mcp__clickstack__clickstack_query_tile',
        {},
        output,
        calledAt,
      ),
    ).toBeUndefined();
  });
});
