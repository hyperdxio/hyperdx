// Unit tests for the Visibility-related helpers exported from
// DashboardFiltersModal. The full modal is React + Mantine + react-hook-form
// + ClickHouse-backed; these tests focus on the pure functions that map the
// schema's two orthogonal fields (`constant`, `renderMode`) onto the three
// Visibility presets the editor exposes (Editable / Read-only / Hidden) and
// back. This pins the documented normalization behavior so a future change
// to either helper has to update the round-trip expectations.
import {
  applyFilterVisibility,
  getFilterVisibility,
} from '../DashboardFiltersModal';

describe('getFilterVisibility', () => {
  it('returns "editable" for a plain filter (no constant, no renderMode)', () => {
    expect(getFilterVisibility({})).toBe('editable');
  });

  it('returns "readonly" for { constant: true, renderMode: "readonly" }', () => {
    expect(
      getFilterVisibility({ constant: true, renderMode: 'readonly' }),
    ).toBe('readonly');
  });

  it('returns "hidden" for { constant: true, renderMode: "hidden" }', () => {
    expect(getFilterVisibility({ constant: true, renderMode: 'hidden' })).toBe(
      'hidden',
    );
  });

  it('normalizes { constant: true } with no renderMode to "readonly"', () => {
    // This is the deliberate normalization the file's header comment
    // documents: an MCP-authored filter with only `constant: true` and
    // no `renderMode` opens in the editor as the Read-only preset, so
    // a user who saves without touching Visibility persists the
    // resolved shape (`renderMode: 'readonly'`).
    expect(getFilterVisibility({ constant: true })).toBe('readonly');
  });

  it('returns "readonly" for { renderMode: "readonly" } with no constant', () => {
    // Schema-level refinement rejects this combination at the API /
    // MCP boundary; the helper still resolves it deterministically in
    // case legacy data slips through.
    expect(getFilterVisibility({ renderMode: 'readonly' })).toBe('readonly');
  });

  it('returns "hidden" for { renderMode: "hidden" } with no constant', () => {
    // Same legacy-tolerance note as the previous test.
    expect(getFilterVisibility({ renderMode: 'hidden' })).toBe('hidden');
  });
});

describe('applyFilterVisibility', () => {
  it('returns { constant: true, renderMode: "readonly" } for "readonly"', () => {
    expect(applyFilterVisibility('readonly')).toEqual({
      constant: true,
      renderMode: 'readonly',
    });
  });

  it('returns { constant: true, renderMode: "hidden" } for "hidden"', () => {
    expect(applyFilterVisibility('hidden')).toEqual({
      constant: true,
      renderMode: 'hidden',
    });
  });

  it('returns {} for "editable" (no spurious undefined entries)', () => {
    // An empty object is intentional: the submit path destructures
    // `constant` and `renderMode` out of the form values before
    // spreading, so returning `{}` here keeps the persisted filter
    // free of `constant: undefined` / `renderMode: undefined` entries
    // that would diff against a server round-trip.
    expect(applyFilterVisibility('editable')).toEqual({});
  });
});

describe('getFilterVisibility + applyFilterVisibility round-trip (HDX-4404)', () => {
  // Pin the post-save shape so a future change to either helper makes
  // this test loud. The "round-trip" is: read the inbound filter's
  // visibility, then apply that same visibility on save (the path a
  // user takes when they open the editor and click Save without
  // changing Visibility).
  const roundTrip = (filter: {
    constant?: boolean;
    renderMode?: 'editable' | 'readonly' | 'hidden';
  }) => applyFilterVisibility(getFilterVisibility(filter));

  it('an MCP filter with only constant: true persists as constant + renderMode: "readonly"', () => {
    expect(roundTrip({ constant: true })).toEqual({
      constant: true,
      renderMode: 'readonly',
    });
  });

  it('a constant + renderMode: "readonly" filter persists unchanged', () => {
    expect(roundTrip({ constant: true, renderMode: 'readonly' })).toEqual({
      constant: true,
      renderMode: 'readonly',
    });
  });

  it('a constant + renderMode: "hidden" filter persists unchanged', () => {
    expect(roundTrip({ constant: true, renderMode: 'hidden' })).toEqual({
      constant: true,
      renderMode: 'hidden',
    });
  });

  it('a plain editable filter persists as { } (no constant, no renderMode)', () => {
    expect(roundTrip({})).toEqual({});
  });
});
