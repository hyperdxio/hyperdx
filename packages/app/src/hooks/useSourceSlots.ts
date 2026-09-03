import { useMemo } from 'react';

import { MAX_SEARCH_SOURCES } from '@/defaults';

/**
 * Run one instance of a hook per selected source of a search.
 *
 * The rules of hooks require a constant hook count per component, but search
 * needs one pipeline per selected source — and `useQueries` can't cover these
 * pipelines (row streams are `useInfiniteQuery`-based, which has no plural
 * form, and the chart/facet pipelines compose other hooks). So the hook count
 * is pinned at MAX_SEARCH_SOURCES here, in one place: unused slots receive
 * `undefined` and every slot hook is expected to self-disable for it.
 *
 * `useSlot` must be a stable, named hook (the rules-of-hooks lint understands
 * `use*`-named parameters) and should return a memoized value, so the array
 * this returns is referentially stable and safe to use in dependency lists.
 *
 * Lives in its own module so both the search hooks and the metadata hooks can
 * use it without an import cycle.
 */
export function useMultiSourceSlots<Item, Opts, Result>(
  items: readonly Item[],
  useSlot: (item: Item | undefined, opts: Opts) => Result,
  opts: Opts,
): Result[] {
  const s0 = useSlot(items[0], opts);
  const s1 = useSlot(items[1], opts);
  const s2 = useSlot(items[2], opts);
  const count = Math.min(items.length, MAX_SEARCH_SOURCES);
  return useMemo(() => [s0, s1, s2].slice(0, count), [s0, s1, s2, count]);
}
