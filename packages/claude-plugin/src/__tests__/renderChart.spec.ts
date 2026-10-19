import { describe, expect, it } from '@jest/globals';

import { renderChart } from '../renderChart';

const result = {
  meta: [
    { name: 'Spans', type: 'UInt64' },
    { name: '__hdx_time_bucket', type: 'DateTime' },
  ],
  data: [
    { Spans: '1', __hdx_time_bucket: '2026-10-13T00:00:00Z' },
    { Spans: '4', __hdx_time_bucket: '2026-10-13T00:05:00Z' },
  ],
};
const call = (body: object) => ({
  tool: 'mcp__clickstack__clickstack_timeseries',
  input: { granularity: '5 minute' },
  output: [{ type: 'text', text: JSON.stringify(body) }],
  calledAt: Date.parse('2026-10-13T00:10:00Z'),
});

describe('renderChart', () => {
  it('ends a trimmed result with a dim note, and only a trimmed one', () => {
    const trimmed = renderChart(
      call({ result, note: 'Result was trimmed' }),
      80,
    );
    expect(trimmed?.at(-1)).toEqual([
      { text: expect.stringContaining('trimmed'), dim: true },
    ]);
    const whole = renderChart(call({ result }), 80);
    expect(whole?.at(-1)?.[0]?.text ?? '').not.toContain('trimmed');
  });
});
