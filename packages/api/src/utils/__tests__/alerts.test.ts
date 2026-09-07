import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  tagsSchema,
} from '@hyperdx/common-utils/dist/types';

import { AlertSource } from '@/models/alert';
import {
  deriveAlertDisplayFields,
  isPopulatedRef,
  resolveAlertDisplayFields,
} from '@/utils/alerts';

const savedSearch = { name: 'Checkout errors', tags: ['checkout', 'p1'] };
const dashboard = {
  name: 'Checkout',
  tags: ['team-checkout'],
  tiles: [{ id: 'tile-1', config: { name: 'Error rate' } }],
};

describe('deriveAlertDisplayFields', () => {
  it('derives from the saved search', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH },
        { savedSearch },
      ),
    ).toEqual({ displayName: 'Checkout errors', tags: ['checkout', 'p1'] });
  });

  it('joins the dashboard and tile names for tile alerts', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.TILE, tileId: 'tile-1' },
        { dashboard },
      ),
    ).toEqual({
      displayName: 'Checkout - Error rate',
      tags: ['team-checkout'],
    });
  });

  it('falls back to "Tile" when the tile is gone or unnamed', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.TILE, tileId: 'deleted-tile' },
        { dashboard },
      ).displayName,
    ).toBe('Checkout - Tile');
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.TILE, tileId: 'tile-1' },
        {
          dashboard: {
            name: 'Checkout',
            tags: [],
            tiles: [{ id: 'tile-1', config: {} }],
          },
        },
      ).displayName,
    ).toBe('Checkout - Tile');
  });

  // The tile name alone would not say where the alert lives, so an unnamed
  // dashboard makes the whole name underivable rather than half-derivable.
  it('yields no name for a tile alert whose dashboard has no name', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.TILE, tileId: 'tile-1' },
        {
          dashboard: {
            name: '  ',
            tags: ['team-checkout'],
            tiles: [{ id: 'tile-1', config: { name: 'Error rate' } }],
          },
        },
      ),
    ).toEqual({ displayName: null, tags: ['team-checkout'] });
  });

  it('derives from the inline chart config', () => {
    expect(
      deriveAlertDisplayFields({
        source: AlertSource.INLINE,
        chartConfig: { name: 'p99 latency' },
      }),
    ).toEqual({ displayName: 'p99 latency', tags: [] });
  });

  // Null, not the generic fallback: writers persist this, and a document that
  // stored "Alert" could never recover its real name once the ref is loaded.
  it('yields null when the referenced entity is not at hand', () => {
    expect(
      deriveAlertDisplayFields({ source: AlertSource.SAVED_SEARCH }),
    ).toEqual({ displayName: null, tags: null });
    expect(deriveAlertDisplayFields({ source: AlertSource.TILE })).toEqual({
      displayName: null,
      tags: null,
    });
    expect(deriveAlertDisplayFields({ source: AlertSource.INLINE })).toEqual({
      displayName: null,
      tags: [],
    });
  });

  it('treats an empty or blank name as missing', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH },
        { savedSearch: { name: '', tags: [] } },
      ).displayName,
    ).toBeNull();
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH },
        { savedSearch: { name: '   ', tags: [] } },
      ).displayName,
    ).toBeNull();
  });

  it('trims the derived name', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH },
        { savedSearch: { name: '  Checkout errors  ', tags: [] } },
      ).displayName,
    ).toBe('Checkout errors');
  });

  // alertDisplayNameSchema caps user input at 512; a longer derived name would
  // fail validation the first time the form that renders it is submitted.
  it('truncates the derived name to 512 characters', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH },
        { savedSearch: { name: 'x'.repeat(600), tags: [] } },
      ).displayName,
    ).toBe('x'.repeat(512));
  });

  // Referenced documents predate these fields and are read straight from
  // Mongo, so anything non-string has to survive derivation.
  it('drops malformed tags', () => {
    expect(
      deriveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH },
        { savedSearch: { name: 'S', tags: ['ok', 7, '', null, 'fine'] } },
      ).tags,
    ).toEqual(['ok', 'fine']);
  });

  it('truncates over-long tags and caps the count to the alert tag limits', () => {
    const longTag = 'x'.repeat(MAX_TAG_LENGTH + 20);
    const { tags } = deriveAlertDisplayFields(
      { source: AlertSource.SAVED_SEARCH },
      {
        savedSearch: {
          name: 'S',
          tags: [
            longTag,
            ...Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`),
          ],
        },
      },
    );

    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags?.[0]).toBe('x'.repeat(MAX_TAG_LENGTH));
    expect(tagsSchema.safeParse(tags).success).toBe(true);
  });

  it('returns a copy of the tags so callers cannot mutate the referenced document', () => {
    const refs = { savedSearch: { name: 'S', tags: ['a'] } };
    const { tags } = deriveAlertDisplayFields(
      { source: AlertSource.SAVED_SEARCH },
      refs,
    );
    tags?.push('b');
    expect(refs.savedSearch.tags).toEqual(['a']);
  });
});

describe('resolveAlertDisplayFields', () => {
  it('prefers the stored value per field', () => {
    expect(
      resolveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH, displayName: 'Custom' },
        { savedSearch },
      ),
    ).toEqual({ displayName: 'Custom', tags: ['checkout', 'p1'] });

    expect(
      resolveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH, tags: ['own'] },
        { savedSearch },
      ),
    ).toEqual({ displayName: 'Checkout errors', tags: ['own'] });
  });

  it('keeps a deliberately emptied tag list', () => {
    expect(
      resolveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH, tags: [] },
        { savedSearch },
      ).tags,
    ).toEqual([]);
  });

  it('falls back to "Alert" and no tags when nothing is derivable', () => {
    expect(
      resolveAlertDisplayFields({ source: AlertSource.SAVED_SEARCH }),
    ).toEqual({ displayName: 'Alert', tags: [] });
  });

  it('treats null as unset', () => {
    expect(
      resolveAlertDisplayFields(
        { source: AlertSource.SAVED_SEARCH, displayName: null, tags: null },
        { savedSearch },
      ),
    ).toEqual({ displayName: 'Checkout errors', tags: ['checkout', 'p1'] });
  });

  it('returns a copy of the stored tags', () => {
    const alert = { source: AlertSource.SAVED_SEARCH, tags: ['a'] };
    resolveAlertDisplayFields(alert).tags.push('b');
    expect(alert.tags).toEqual(['a']);
  });
});

describe('isPopulatedRef', () => {
  it.each([
    [{ _id: 'abc' }, true],
    [{}, false],
    [null, false],
    [undefined, false],
    ['abc', false],
  ])('%p -> %p', (value, expected) => {
    expect(isPopulatedRef(value)).toBe(expected);
  });
});
