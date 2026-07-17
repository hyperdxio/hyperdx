import { describe, expect, it } from '@jest/globals';

import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import type { SQLInterval } from '@hyperdx/common-utils/dist/types';

import { formatResponseForTimeChart } from '@/shared/chartData';

const dateRange: [Date, Date] = [
  new Date('2026-07-01T00:00:00Z'),
  new Date('2026-07-15T00:00:00Z'),
];

function makeResponse(): ResponseJSON<Record<string, unknown>> {
  return {
    meta: [
      { name: 'ts', type: 'DateTime' },
      { name: 'count()', type: 'UInt64' },
    ],
    data: [
      { ts: '2026-07-02T00:00:00Z', 'count()': '3' },
      { ts: '2026-07-09T00:00:00Z', 'count()': '7' },
    ],
    rows: 2,
  };
}

describe('formatResponseForTimeChart', () => {
  it('fills empty buckets for supported granularities', () => {
    const { graphResults } = formatResponseForTimeChart({
      response: makeResponse(),
      dateRange,
      granularity: '1 day',
      generateEmptyBuckets: true,
    });
    // 14 days of buckets, zero-filled where the response has no row
    expect(graphResults.length).toBe(14);
  });

  it.each(['1 week', '1 month', 'banana'] as SQLInterval[])(
    'returns promptly without empty buckets for unsupported granularity %j',
    granularity => {
      // Regression: convertGranularityToSeconds returns 0 for units
      // beyond day, which previously made empty-bucket generation loop
      // forever (this test would hang, not fail).
      const { graphResults } = formatResponseForTimeChart({
        response: makeResponse(),
        dateRange,
        granularity,
        generateEmptyBuckets: true,
      });
      // Only the real result rows survive
      expect(graphResults.length).toBe(2);
    },
  );
});
