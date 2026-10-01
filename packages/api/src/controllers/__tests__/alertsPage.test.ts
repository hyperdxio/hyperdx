import { MAX_TAGS } from '@hyperdx/common-utils/dist/types';

import {
  alertsPageQuerySchema,
  buildAlertsPageFilter,
} from '@/controllers/alertsPage';
import { AlertSource, AlertState } from '@/models/alert';
import { encodeCursor } from '@/utils/pagination';

const TEAM_ID = '6500000000000000000000aa';
const ALERT_ID = '6500000000000000000000bb';

const parse = (query: Record<string, unknown>) =>
  alertsPageQuerySchema.parse(query);

const buildFilter = (query: Record<string, unknown> = {}) =>
  buildAlertsPageFilter(TEAM_ID, parse(query));

describe('alertsPageQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(parse({})).toEqual({});
  });

  it('normalizes a repeatable param whether it arrives once or many times', () => {
    expect(parse({ tag: 'prod' }).tag).toEqual(['prod']);
    expect(parse({ tag: ['prod', 'web'] }).tag).toEqual(['prod', 'web']);
    expect(parse({ tag: '' }).tag).toBeUndefined();
  });

  it('rejects more tags than an alert can carry', () => {
    expect(() => parse({ tag: Array(MAX_TAGS + 1).fill('t') })).toThrow();
  });

  it('coerces limit and rejects out-of-range values', () => {
    expect(parse({ limit: '25' }).limit).toBe(25);
    expect(() => parse({ limit: '0' })).toThrow();
    expect(() => parse({ limit: '501' })).toThrow();
    expect(() => parse({ limit: '1.5' })).toThrow();
  });

  it('accepts limit and tag count at their inclusive bounds', () => {
    expect(parse({ limit: '1' }).limit).toBe(1);
    expect(parse({ limit: '500' }).limit).toBe(500);
    expect(parse({ tag: Array(MAX_TAGS).fill('t') }).tag).toHaveLength(
      MAX_TAGS,
    );
  });

  it('trims search and rejects an overlong one', () => {
    expect(parse({ search: '  errors ' }).search).toBe('errors');
    expect(() => parse({ search: 'x'.repeat(513) })).toThrow();
  });

  it('rejects values outside the source and state enums', () => {
    expect(parse({ source: 'tile' }).source).toEqual([AlertSource.TILE]);
    expect(() => parse({ source: 'nope' })).toThrow();
    expect(() => parse({ state: 'nope' })).toThrow();
  });

  it('rejects a non-ObjectId createdBy', () => {
    expect(() => parse({ createdBy: 'not-an-id' })).toThrow();
  });

  it('survives re-parsing its own output', () => {
    // processRequest writes the parsed query back onto req.query, and the
    // handler parses that again to recover the coerced types.
    const once = parse({
      limit: '2',
      tag: ['prod', 'web'],
      source: 'tile',
      state: 'OK',
      search: ' errors ',
      createdBy: ALERT_ID,
    });
    expect(alertsPageQuerySchema.parse(once)).toEqual(once);
  });

  it('rejects a cursor with no limit to continue', () => {
    const cursor = encodeCursor({ n: 'a', id: ALERT_ID });
    expect(() => parse({ cursor })).toThrow('cursor requires limit');
    expect(parse({ cursor, limit: '2' }).cursor).toBe(cursor);
  });

  it.each([
    ['garbage', 'not a cursor!'],
    ['a non-ObjectId id', encodeCursor({ n: 'a', id: 'nope' })],
    // JSON.stringify drops an undefined value, so a writer that doesn't
    // normalize a missing displayName to null issues a cursor like this.
    ['a missing name', encodeCursor({ id: ALERT_ID })],
  ])('rejects a cursor with %s', (_label, cursor) => {
    expect(() => parse({ cursor, limit: '2' })).toThrow('invalid cursor');
  });
});

describe('buildAlertsPageFilter', () => {
  it('scopes to the team and nothing else when unfiltered', () => {
    expect(buildFilter()).toEqual({ team: TEAM_ID });
  });

  it('matches any requested tag', () => {
    expect(buildFilter({ tag: ['prod', 'web'] }).tags).toEqual({
      $in: ['prod', 'web'],
    });
  });

  it('matches documents with no source field when saved_search is requested', () => {
    // `source` postdates the first alerts; those documents are saved searches.
    expect(
      buildFilter({ source: [AlertSource.SAVED_SEARCH, AlertSource.TILE] })
        .source,
    ).toEqual({ $in: [AlertSource.SAVED_SEARCH, AlertSource.TILE, null] });

    expect(buildFilter({ source: AlertSource.TILE }).source).toEqual({
      $in: [AlertSource.TILE],
    });
  });

  it('matches documents with no state field when ok is requested', () => {
    // `state` postdates the first alerts; those documents hydrate as OK.
    expect(
      buildFilter({ state: [AlertState.OK, AlertState.ALERT] }).state,
    ).toEqual({ $in: [AlertState.OK, AlertState.ALERT, null] });

    expect(buildFilter({ state: AlertState.ALERT }).state).toEqual({
      $in: [AlertState.ALERT],
    });
  });

  it('filters on state and createdBy by equality', () => {
    const filter = buildFilter({
      state: [AlertState.ALERT],
      createdBy: ALERT_ID,
    });
    expect(filter.state).toEqual({ $in: [AlertState.ALERT] });
    expect(filter.createdBy).toBe(ALERT_ID);
  });

  it('treats regex metacharacters in search as literals', () => {
    expect(buildFilter({ search: 'a.b(c' }).displayName).toEqual({
      $regex: 'a\\.b\\(c',
      $options: 'i',
    });
  });

  it('adds no displayName predicate for a blank search', () => {
    // A cleared search box sends `search=`, and trimming a whitespace-only one
    // lands in the same place. Neither may become a match-everything regex.
    expect(buildFilter({ search: '' }).displayName).toBeUndefined();
    expect(buildFilter({ search: '   ' }).displayName).toBeUndefined();
  });

  it('pages past a named alert with a scoped tie-break', () => {
    const filter = buildFilter({
      limit: '2',
      cursor: encodeCursor({ n: 'Checkout', id: ALERT_ID }),
    });

    // The _id tie-break is scoped to the cursor's own name so neither branch
    // rescans the run of rows sharing it.
    expect(filter.displayName).toBeUndefined();
    expect(filter.$or).toEqual([
      { displayName: { $gt: 'Checkout' } },
      { displayName: 'Checkout', _id: { $gt: ALERT_ID } },
    ]);
  });

  it('pages out of the unnamed block into the named alerts', () => {
    const filter = buildFilter({
      limit: '2',
      cursor: encodeCursor({ n: null, id: ALERT_ID }),
    });

    expect(filter.displayName).toBeUndefined();
    expect(filter.$or).toEqual([
      { displayName: null, _id: { $gt: ALERT_ID } },
      { displayName: { $gte: '' } },
    ]);
  });

  it('keeps the search predicate alongside a named cursor', () => {
    const filter = buildFilter({
      limit: '2',
      search: 'err',
      cursor: encodeCursor({ n: 'Checkout', id: ALERT_ID }),
    });

    expect(filter.displayName).toEqual({ $regex: 'err', $options: 'i' });
    expect(filter.$or).toEqual([
      { displayName: { $gt: 'Checkout' } },
      { displayName: 'Checkout', _id: { $gt: ALERT_ID } },
    ]);
  });

  it('keeps the search predicate alongside a null cursor', () => {
    const filter = buildFilter({
      limit: '2',
      search: 'err',
      cursor: encodeCursor({ n: null, id: ALERT_ID }),
    });

    expect(filter.displayName).toEqual({ $regex: 'err', $options: 'i' });
    expect(filter.$or).toEqual([
      { displayName: null, _id: { $gt: ALERT_ID } },
      { displayName: { $gte: '' } },
    ]);
  });

  it('leaves $or to the cursor when the widened filters are applied', () => {
    // The missing-field branches spell "documents with no source/state field"
    // as `$in: [..., null]` rather than a second `$or`, which would overwrite
    // the cursor's and silently restart the walk.
    const filter = buildFilter({
      limit: '2',
      source: AlertSource.SAVED_SEARCH,
      state: AlertState.OK,
      cursor: encodeCursor({ n: null, id: ALERT_ID }),
    });

    expect(filter.source).toEqual({ $in: [AlertSource.SAVED_SEARCH, null] });
    expect(filter.state).toEqual({ $in: [AlertState.OK, null] });
    expect(filter.$or).toEqual([
      { displayName: null, _id: { $gt: ALERT_ID } },
      { displayName: { $gte: '' } },
    ]);
  });
});
