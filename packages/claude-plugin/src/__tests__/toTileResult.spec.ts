import { describe, expect, it } from '@jest/globals';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import {
  chartedTool,
  isChartable,
  isTrimmed,
  parseResponse,
  toTileResult,
} from '../toTileResult';

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

  it('defaults to the server defaults: line and the last 15 minutes', () => {
    const result = toTileResult(
      'mcp__clickstack__clickstack_timeseries',
      {},
      output,
      calledAt,
    );
    expect(result?.queriedConfig).toMatchObject({
      displayType: DisplayType.Line,
      dateRange: [new Date('2026-10-13T00:45:00Z'), new Date(calledAt)],
    });
  });

  it('fills empty buckets only for an explicit granularity on a whole result', () => {
    const run = (input: object, out: unknown) =>
      toTileResult(
        'mcp__clickstack__clickstack_timeseries',
        input,
        out,
        calledAt,
      )?.queriedConfig;
    const trimmed = [
      {
        type: 'text',
        text: JSON.stringify({ result: response, note: 'Result was trimmed' }),
      },
    ];
    expect(run({}, output)).toMatchObject({ fillNulls: false });
    expect(run({ granularity: '5 minute' }, trimmed)).toMatchObject({
      fillNulls: false,
    });
    expect(run({ granularity: '5 minute' }, output)?.fillNulls).toBeUndefined();
  });

  it('follows the server turning multi-select number, pie and bar into a table', () => {
    for (const shape of ['number', 'pie', 'bar']) {
      const result = toTileResult(
        'mcp__clickstack__clickstack_table',
        { shape, select: [{ aggFn: 'count' }, { aggFn: 'max' }] },
        output,
        calledAt,
      );
      expect(result?.queriedConfig.displayType).toBe(DisplayType.Table);
    }
  });

  it('keeps a single-select number chart and a multi-select table as asked', () => {
    const shapeOf = (input: object) =>
      toTileResult('mcp__clickstack__clickstack_table', input, output, calledAt)
        ?.queriedConfig.displayType;
    expect(shapeOf({ shape: 'number', select: [{ aggFn: 'count' }] })).toBe(
      DisplayType.Number,
    );
    expect(
      shapeOf({
        shape: 'table',
        select: [{ aggFn: 'count' }, { aggFn: 'max' }],
      }),
    ).toBe(DisplayType.Table);
  });

  it('notices a trimmed result', () => {
    expect(isTrimmed(output)).toBe(false);
    expect(
      isTrimmed([
        { type: 'text', text: JSON.stringify({ result: response, note: 'x' }) },
      ]),
    ).toBe(true);
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
      valueExpression: 'Duration',
      granularity: '1 minute',
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

  it('rejects a heatmap body that does not match the shared schema', () => {
    const bad = (heatmap: object) => [
      { type: 'text', text: JSON.stringify({ heatmap }) },
    ];
    const body = {
      valueExpression: 'Duration',
      granularity: '1 minute',
      scale: 'log',
      times: ['2026-10-13T00:00:00.000Z'],
      valueEdges: [1, 10],
      counts: [[0, 1, 0]],
    };
    const tool = 'mcp__clickstack__clickstack_heatmap';
    expect(toTileResult(tool, {}, bad(body), calledAt)).toBeDefined();
    const { granularity: _omit, ...noGranularity } = body;
    expect(
      toTileResult(tool, {}, bad(noGranularity), calledAt),
    ).toBeUndefined();
    expect(
      toTileResult(tool, {}, bad({ ...body, counts: 'x' }), calledAt),
    ).toBeUndefined();
  });

  it('keeps only results it can draw for caching', () => {
    const heatmapBody = [
      {
        type: 'text',
        text: JSON.stringify({
          heatmap: {
            valueExpression: 'Duration',
            granularity: '1 minute',
            scale: 'log',
            times: ['2026-10-13T00:00:00.000Z'],
            valueEdges: [1, 10],
            counts: [[0, 1, 0]],
          },
        }),
      },
    ];
    expect(
      isChartable('mcp__clickstack__clickstack_query_tile', {}, heatmapBody),
    ).toBe(true);
    expect(
      isChartable('mcp__clickstack__clickstack_query_tile', {}, output),
    ).toBe(false);
    expect(isChartable('mcp__clickstack__clickstack_search', {}, output)).toBe(
      false,
    );
  });
});
