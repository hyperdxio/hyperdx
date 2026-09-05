import { clampCatalogDateRange } from '@/hooks/useMetricCatalog';

const NOW = new Date('2026-08-22T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('clampCatalogDateRange', () => {
  it('defaults to the last day when no range is given', () => {
    expect(clampCatalogDateRange(undefined, NOW)).toEqual([
      at('2026-08-21T12:00:00Z'),
      NOW,
    ]);
  });

  it('widens a sub-day range forward to a full day', () => {
    // An hour of data is not enough to tell what a source reports, and the
    // metric tables are partitioned by day, so widening costs nothing extra.
    expect(
      clampCatalogDateRange(
        [at('2026-08-20T09:00:00Z'), at('2026-08-20T10:00:00Z')],
        NOW,
      ),
    ).toEqual([at('2026-08-20T09:00:00Z'), at('2026-08-21T09:00:00Z')]);
  });

  it('widens backward instead when a full day forward would pass now', () => {
    expect(
      clampCatalogDateRange([at('2026-08-22T09:00:00Z'), NOW], NOW),
    ).toEqual([at('2026-08-21T12:00:00Z'), NOW]);
  });

  it('keeps a range that is already between one and three days', () => {
    const range: [Date, Date] = [
      at('2026-08-20T00:00:00Z'),
      at('2026-08-22T00:00:00Z'),
    ];
    expect(clampCatalogDateRange(range, NOW)).toEqual(range);
  });

  it('clamps a long range to the most recent three days', () => {
    // Otherwise the catalog query would scan every partition the source has.
    expect(
      clampCatalogDateRange(
        [at('2026-01-01T00:00:00Z'), at('2026-08-22T00:00:00Z')],
        NOW,
      ),
    ).toEqual([at('2026-08-19T00:00:00Z'), at('2026-08-22T00:00:00Z')]);
  });

  it('never widens past the requested end', () => {
    const [, end] = clampCatalogDateRange(
      [at('2026-08-01T00:00:00Z'), at('2026-08-10T00:00:00Z')],
      NOW,
    );
    expect(end).toEqual(at('2026-08-10T00:00:00Z'));
  });
});
