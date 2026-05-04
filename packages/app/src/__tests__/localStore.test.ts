import { SavedSearch, TSource } from '@hyperdx/common-utils/dist/types';

// Mock config so we can control HDX_LOCAL_DEFAULT_SOURCES in tests
jest.mock('../config', () => ({
  HDX_LOCAL_DEFAULT_SOURCES: null,
}));

// Mock parseJSON so tests aren't coupled to its implementation.
// Returns null for empty/falsy input, matching the real parseJSON behaviour.
jest.mock('../utils', () => ({
  parseJSON: jest.fn((s: string) => {
    if (!s) return null;
    return JSON.parse(s);
  }),
}));

import {
  createEntityStore,
  generateDeterministicId,
  localSavedSearches,
  localSources,
} from '../localStore';

type Item = { id: string; name: string };

const TEST_KEY = 'test-entity-store';

function makeStore() {
  return createEntityStore<Item>(TEST_KEY);
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createEntityStore — core CRUD
// ---------------------------------------------------------------------------

describe('createEntityStore', () => {
  describe('getAll', () => {
    it('returns empty array when store is empty', () => {
      const store = makeStore();
      expect(store.getAll()).toEqual([]);
    });

    it('returns stored items', () => {
      const store = makeStore();
      store.create({ name: 'alpha' });
      store.create({ name: 'beta' });
      expect(store.getAll()).toHaveLength(2);
      expect(store.getAll().map(i => i.name)).toEqual(['alpha', 'beta']);
    });

    it('calls getDefaultItems when the key is absent', () => {
      const defaults: Item[] = [{ id: 'default-1', name: 'default' }];
      const getDefaultItems = jest.fn(() => defaults);
      const store = createEntityStore<Item>(TEST_KEY, getDefaultItems);

      const result = store.getAll();

      expect(getDefaultItems).toHaveBeenCalledTimes(1);
      expect(result).toEqual(defaults);
    });

    it('does not call getDefaultItems once data exists in storage', () => {
      const getDefaultItems = jest.fn(() => [
        { id: 'default-1', name: 'default' },
      ]);
      const store = createEntityStore<Item>(TEST_KEY, getDefaultItems);

      // First write: key absent, so getDefaultItems is used to seed transact
      store.create({ name: 'persisted' });
      getDefaultItems.mockClear();

      // Subsequent reads/writes should not consult defaults
      store.getAll();
      expect(getDefaultItems).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('persists a new item and returns it with a generated id', () => {
      const store = makeStore();
      const created = store.create({ name: 'new item' });

      expect(created.name).toBe('new item');
      expect(created.id).toBeDefined();
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0]).toEqual(created);
    });

    it('generates hex ids matching /[0-9a-f]+/', () => {
      const store = makeStore();
      const { id } = store.create({ name: 'x' });
      expect(id).toMatch(/^[0-9a-f]+$/);
    });

    it('each create appends without replacing existing items', () => {
      const store = makeStore();
      store.create({ name: 'first' });
      store.create({ name: 'second' });
      store.create({ name: 'third' });

      expect(store.getAll()).toHaveLength(3);
    });

    describe('with generateDeterministicId', () => {
      it('generates deterministic ids from item content', () => {
        const storeA = createEntityStore<Item>(
          'store-det-a',
          undefined,
          generateDeterministicId,
        );
        const storeB = createEntityStore<Item>(
          'store-det-b',
          undefined,
          generateDeterministicId,
        );

        const a = storeA.create({ name: 'demo-source' });
        const b = storeB.create({ name: 'demo-source' });

        expect(a.id).toBe(b.id);
      });

      it('generates the same id regardless of property insertion order', () => {
        type MultiProp = { id: string; name: string; kind: string };
        const storeA = createEntityStore<MultiProp>(
          'store-ord-a',
          undefined,
          generateDeterministicId,
        );
        const storeB = createEntityStore<MultiProp>(
          'store-ord-b',
          undefined,
          generateDeterministicId,
        );

        const a = storeA.create({ name: 'demo', kind: 'log' });
        const b = storeB.create({ kind: 'log', name: 'demo' });

        expect(a.id).toBe(b.id);
      });

      it('generates different ids for items with different content', () => {
        const store = createEntityStore<Item>(
          TEST_KEY,
          undefined,
          generateDeterministicId,
        );
        const a = store.create({ name: 'alpha' });
        const b = store.create({ name: 'beta' });
        expect(a.id).not.toBe(b.id);
      });
    });
  });

  describe('update', () => {
    it('updates the matching item and returns the updated value', () => {
      const store = makeStore();
      const { id } = store.create({ name: 'original' });

      const updated = store.update(id, { name: 'updated' });

      expect(updated).toEqual({ id, name: 'updated' });
      expect(store.getAll()[0]).toEqual({ id, name: 'updated' });
    });

    it('preserves other items when updating', () => {
      const store = makeStore();
      const a = store.create({ name: 'a' });
      const b = store.create({ name: 'b' });

      store.update(a.id, { name: 'a-updated' });

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all.find(i => i.id === b.id)?.name).toBe('b');
    });

    it('preserves the original id even if updates include an id field', () => {
      const store = makeStore();
      const { id } = store.create({ name: 'x' });

      const updated = store.update(id, {
        name: 'y',
        id: 'injected-id',
      } as Partial<Omit<Item, 'id'>>);

      expect(updated.id).toBe(id);
    });

    it('throws when id is not found', () => {
      const store = makeStore();
      expect(() => store.update('nonexistent', { name: 'x' })).toThrow(
        /not found/,
      );
    });
  });

  describe('delete', () => {
    it('removes the item with the given id', () => {
      const store = makeStore();
      const { id } = store.create({ name: 'to-delete' });
      store.create({ name: 'keep' });

      store.delete(id);

      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('keep');
    });

    it('is a no-op for a non-existent id', () => {
      const store = makeStore();
      store.create({ name: 'a' });

      expect(() => store.delete('nonexistent')).not.toThrow();
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe('set', () => {
    it('replaces the entire collection', () => {
      const store = makeStore();
      store.create({ name: 'old' });

      const replacement: Item[] = [
        { id: 'x1', name: 'new-a' },
        { id: 'x2', name: 'new-b' },
      ];
      store.set(replacement);

      expect(store.getAll()).toEqual(replacement);
    });

    it('set with empty array clears the store', () => {
      const store = makeStore();
      store.create({ name: 'a' });
      store.set([]);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('isolation', () => {
    it('two stores with different keys do not share data', () => {
      const storeA = createEntityStore<Item>('key-a');
      const storeB = createEntityStore<Item>('key-b');

      storeA.create({ name: 'a-item' });

      expect(storeB.getAll()).toEqual([]);
    });
  });

  describe('mutations against env-var defaults (key absent from localStorage)', () => {
    const defaults: Item[] = [{ id: 'default-id', name: 'default-item' }];

    function makeStoreWithDefaults() {
      return createEntityStore<Item>(TEST_KEY, () => defaults);
    }

    it('update finds an item that exists only in defaults', () => {
      const store = makeStoreWithDefaults();
      // Nothing in localStorage yet — getAll() returns defaults
      expect(store.getAll()).toEqual(defaults);

      const updated = store.update('default-id', { name: 'updated-name' });

      expect(updated).toEqual({ id: 'default-id', name: 'updated-name' });
      // After the write the value is now in localStorage
      expect(store.getAll()).toEqual([
        { id: 'default-id', name: 'updated-name' },
      ]);
    });

    it('delete removes an item that exists only in defaults', () => {
      const store = makeStoreWithDefaults();

      store.delete('default-id');

      expect(store.getAll()).toEqual([]);
    });

    it('create preserves defaults when adding a new item', () => {
      const store = makeStoreWithDefaults();

      const created = store.create({ name: 'brand-new' });

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all.find(i => i.id === 'default-id')).toBeDefined();
      expect(all.find(i => i.id === created.id)).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// localSources — env-var default fallback
// ---------------------------------------------------------------------------

describe('localSources', () => {
  const mockedUtils = jest.requireMock('../utils') as { parseJSON: jest.Mock };
  const mockedConfig = jest.requireMock('../config') as {
    HDX_LOCAL_DEFAULT_SOURCES: string | null;
  };

  it('returns empty array when storage is empty and no env-var default', () => {
    mockedConfig.HDX_LOCAL_DEFAULT_SOURCES = null;
    expect(localSources.getAll()).toEqual([]);
  });

  it('returns env-var defaults when storage is empty', () => {
    const defaults = [{ id: 'src-1', name: 'Demo Logs' }];
    mockedConfig.HDX_LOCAL_DEFAULT_SOURCES = JSON.stringify(defaults);
    mockedUtils.parseJSON.mockReturnValueOnce(defaults);

    expect(localSources.getAll()).toEqual(defaults);
  });

  it('persists defaults + new item on first write and stops consulting env-var after', () => {
    const envDefaults = [{ id: 'env-src', name: 'Env Source' }];
    mockedConfig.HDX_LOCAL_DEFAULT_SOURCES = JSON.stringify(envDefaults);

    const stored = localSources.create({ name: 'My Source' } as Omit<
      TSource,
      'id'
    >);
    mockedUtils.parseJSON.mockClear();

    const all = localSources.getAll();
    expect(all).toHaveLength(2);
    expect(all.find(s => s.id === 'env-src')).toBeDefined();
    expect(all.find(s => s.id === stored.id)).toBeDefined();

    // Subsequent reads do not consult env-var defaults
    expect(mockedUtils.parseJSON).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// localSavedSearches — basic sanity (delegates to createEntityStore)
// ---------------------------------------------------------------------------

describe('localSavedSearches', () => {
  it('starts empty', () => {
    expect(localSavedSearches.getAll()).toEqual([]);
  });

  it('creates, updates, and deletes a saved search', () => {
    const created = localSavedSearches.create({
      name: 'My Search',
      select: 'Timestamp, Body',
      where: '',
      whereLanguage: 'lucene',
      source: 'src-1',
      tags: [],
      filters: [],
      orderBy: '',
    } as Omit<SavedSearch, 'id'>);

    expect(created.id).toMatch(/^[0-9a-f]+$/);
    expect(localSavedSearches.getAll()).toHaveLength(1);

    localSavedSearches.update(created.id, { name: 'Renamed' });
    expect(localSavedSearches.getAll()[0].name).toBe('Renamed');

    localSavedSearches.delete(created.id);
    expect(localSavedSearches.getAll()).toHaveLength(0);
  });
});
