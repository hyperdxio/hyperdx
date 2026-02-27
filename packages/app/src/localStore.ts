import store from 'store2';
import { hashCode } from '@hyperdx/common-utils/dist/core/utils';
import { SavedSearch, TSource } from '@hyperdx/common-utils/dist/types';

import { HDX_LOCAL_DEFAULT_SOURCES } from './config';
import { parseJSON } from './utils';

type EntityWithId = { id: string };

/**
 * Generic localStorage CRUD store for local-mode entities.
 * Uses store2 for atomic transact operations and JSON serialization.
 */
export function createEntityStore<T extends EntityWithId>(
  key: string,
  getDefaultItems?: () => T[],
) {
  function getAll(): T[] {
    if (getDefaultItems != null && !store.has(key)) {
      return getDefaultItems();
    }
    return store.get(key, []);
  }

  return {
    getAll,

    create(item: Omit<T, 'id'>): T {
      const newItem = {
        ...item,
        id: Math.abs(hashCode(Math.random().toString())).toString(16),
      } as T;
      store.transact(key, (prev: T[]) => [...(prev ?? []), newItem], []);
      return newItem;
    },

    update(id: string, updates: Partial<Omit<T, 'id'>>): T {
      let updated: T | undefined;
      store.transact(
        key,
        (prev: T[]) =>
          (prev ?? []).map(item => {
            if (item.id === id) {
              updated = { ...item, ...updates, id };
              return updated;
            }
            return item;
          }),
        [],
      );
      if (updated == null) {
        throw new Error(
          `Local store: entity with id "${id}" not found in "${key}"`,
        );
      }
      return updated;
    },

    delete(id: string): void {
      store.transact(
        key,
        (prev: T[]) => (prev ?? []).filter(item => item.id !== id),
        [],
      );
    },

    /** Replace the entire collection atomically (used for single-item stores like connections). */
    set(items: T[]): void {
      store.set(key, items);
    },
  };
}

/**
 * Sources store with env-var default fallback.
 * Keeps the existing "hdx-local-source" key for backward compatibility.
 */
export const localSources = createEntityStore<TSource>(
  'hdx-local-source',
  () => {
    try {
      const defaults = parseJSON(HDX_LOCAL_DEFAULT_SOURCES ?? '');
      if (defaults != null) return defaults;
    } catch (e) {
      console.error('Error loading default sources', e);
    }
    return [];
  },
);

/** Saved searches store (alerts remain cloud-only; no alert fields persisted locally). */
export const localSavedSearches = createEntityStore<SavedSearch>(
  'hdx-local-saved-searches',
);
