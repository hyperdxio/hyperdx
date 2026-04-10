import objectHash from 'object-hash';
import store from 'store2';
import {
  SavedSearchListApiResponse,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { HDX_LOCAL_DEFAULT_SOURCES } from './config';
import { parseJSON } from './utils';

type EntityWithId = { id: string };

const generateRandomId = () =>
  objectHash({ random: Math.random() }).slice(0, 16);

export const generateDeterministicId = (item: object) =>
  objectHash(item).slice(0, 16);

/**
 * Generic localStorage CRUD store for local-mode entities.
 * Uses store2 for atomic transact operations and JSON serialization.
 */
export function createEntityStore<T extends EntityWithId>(
  key: string,
  getDefaultItems?: () => T[],
  generateObjectId: (item: Omit<T, 'id'>) => string = generateRandomId,
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
        id: generateObjectId(item),
      } as T;
      // Seed transact from defaults when the key is absent so that
      // env-var-seeded items are not silently dropped on the first write.
      const alt = !store.has(key) ? (getDefaultItems?.() ?? []) : [];
      store.transact(key, (prev: T[]) => [...(prev ?? []), newItem], alt);
      return newItem;
    },

    update(id: string, updates: Partial<Omit<T, 'id'>>): T {
      let updated: T | undefined;
      // Same rationale: seed transact from defaults when the key is absent so
      // that updates against env-var-provided items don't throw 'not found'.
      const alt = !store.has(key) ? (getDefaultItems?.() ?? []) : [];
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
        alt,
      );
      if (updated == null) {
        throw new Error(
          `Local store: entity with id "${id}" not found in "${key}"`,
        );
      }
      return updated;
    },

    delete(id: string): void {
      const alt = !store.has(key) ? (getDefaultItems?.() ?? []) : [];
      store.transact(
        key,
        (prev: T[]) => (prev ?? []).filter(item => item.id !== id),
        alt,
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
  // Make the id deterministic so that local-mode source IDs remain stable across users, for easy local-mode sharing
  generateDeterministicId,
);

/** Saved searches store (alerts remain cloud-only; no alert fields persisted locally). */
export const localSavedSearches = createEntityStore<SavedSearchListApiResponse>(
  'hdx-local-saved-searches',
);
