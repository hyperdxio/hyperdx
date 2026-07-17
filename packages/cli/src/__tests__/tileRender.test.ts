import { describe, expect, it } from '@jest/globals';

import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { renderTileContent } from '@/shared/tileRender';
import type { TileQueryResult } from '@/shared/tileQuery';

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
});
