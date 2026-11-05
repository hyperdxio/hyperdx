import { describe, expect, it } from '@jest/globals';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import {
  chartedTool,
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
});
