import { Types } from 'mongoose';

import { alertQueryAttribution } from '@/tasks/checkAlerts';
import { AlertTaskType } from '@/tasks/checkAlerts/providers';

// Real AlertDetails comes from mongoose documents. These tests only need the
// few fields the tag reads.

const details = (overrides: Record<string, unknown>): any => ({
  alert: { id: 'alert-1' },
  ...overrides,
});

describe('alertQueryAttribution', () => {
  it('reports the saved search for a saved-search alert', () => {
    expect(
      alertQueryAttribution(
        details({
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch: { id: 'search-1' },
          source: { id: 'source-1' },
        }),
      ),
    ).toMatchObject({
      surface: 'alert',
      alert: 'alert-1',
      search: 'search-1',
      source: 'source-1',
    });
  });

  it('reports the dashboard and tile for a tile alert', () => {
    expect(
      alertQueryAttribution(
        details({
          taskType: AlertTaskType.TILE,
          dashboard: { id: 'dash-1' },
          tile: { id: 'tile-1' },
          source: { id: 'source-1' },
        }),
      ),
    ).toMatchObject({ dashboard: 'dash-1', tile: 'tile-1' });
  });

  // The tile path goes through `toObject()`, which leaves out the `id`
  // virtual, so the source arrives with only `_id`. This used to report no
  // source at all.
  it('falls back to _id when the source has no id virtual', () => {
    const _id = new Types.ObjectId();
    expect(
      alertQueryAttribution(
        details({
          taskType: AlertTaskType.TILE,
          dashboard: { id: 'dash-1' },
          tile: { id: 'tile-1' },
          source: { _id },
        }),
      ).source,
    ).toBe(_id.toString());
  });

  it('omits the source when the alert has none', () => {
    expect(
      alertQueryAttribution(
        details({ taskType: AlertTaskType.INLINE, chartConfig: {} }),
      ),
    ).toMatchObject({ surface: 'alert', source: undefined });
  });

  it('does not throw on a partially populated alert', () => {
    expect(() =>
      alertQueryAttribution({ taskType: AlertTaskType.SAVED_SEARCH } as any),
    ).not.toThrow();
  });
});
