import { useMemo } from 'react';
import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import { MultiSourceExtraColumn } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { MAX_SEARCH_SOURCES } from '@/defaults';
import { useColumns } from '@/hooks/useMetadata';

/**
 * Run one instance of a hook per selected source of a multi-source search.
 *
 * The rules of hooks require a constant hook count per component, but multi
 * mode needs one query pipeline per selected source — and `useQueries` can't
 * cover these pipelines (the row streams are `useInfiniteQuery`-based, which
 * has no plural form, and the chart pipeline composes other hooks). So the
 * hook count is pinned at MAX_SEARCH_SOURCES here, in one place: unused
 * slots receive `undefined` and every slot hook is expected to self-disable
 * for it.
 *
 * `useSlot` must be a stable, named hook (the rules-of-hooks lint understands
 * `use*`-named parameters) and should return a memoized value, so the array
 * this returns is referentially stable and safe to use in dependency lists.
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

const EMPTY_SOURCE_PARAMS = {
  databaseName: '',
  tableName: '',
  connectionId: '',
};

function columnsParamsFor(source: TSource | undefined) {
  if (source == null) return EMPTY_SOURCE_PARAMS;
  return {
    databaseName: source.from.databaseName,
    tableName: source.from.tableName,
    connectionId: source.connection,
  };
}

export type MultiSourceColumnOption = {
  name: string;
  /** How many of the selected sources have this column. */
  availableCount: number;
};

/** Slot hook: DESCRIBE columns for one source. Stable — `.data` is cached. */
function useSourceColumnsSlot(
  source: TSource | undefined,
): ColumnMeta[] | undefined {
  return useColumns(columnsParamsFor(source)).data;
}

/**
 * Top-level columns (DESCRIBE) for each selected source of a multi-source
 * search, plus the deduped union with per-column availability counts for the
 * add-column picker. useColumns self-disables for unused slots.
 */
export function useMultiSourceColumns(sources: TSource[]): {
  columnsBySourceId: Map<string, Set<string>>;
  unionColumns: MultiSourceColumnOption[];
} {
  const slotData = useMultiSourceSlots(
    sources,
    useSourceColumnsSlot,
    undefined,
  );

  return useMemo(() => {
    const columnsBySourceId = new Map<string, Set<string>>();
    const availability = new Map<string, number>();

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const columns = slotData[i];
      if (source == null || columns == null) continue;
      const names = new Set(columns.map(c => c.name));
      columnsBySourceId.set(source.id, names);
      for (const name of names) {
        availability.set(name, (availability.get(name) ?? 0) + 1);
      }
    }

    const unionColumns = [...availability.entries()]
      .map(([name, availableCount]) => ({ name, availableCount }))
      .sort(
        (a, b) =>
          b.availableCount - a.availableCount || a.name.localeCompare(b.name),
      );

    return { columnsBySourceId, unionColumns };
  }, [slotData, sources]);
}

/** Quote a column name as a ClickHouse identifier when it needs it. */
function quoteIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `\`${name.replace(/`/g, '\\`')}\``;
}

/**
 * Resolve the user-picked extra column names into per-source SELECT
 * expressions: the (quoted) column itself where the source's table has it,
 * NULL otherwise — so every source still returns the same result shape.
 */
export function resolveExtraColumnsForSource(
  extraColumnNames: string[],
  sourceColumns: Set<string> | undefined,
): MultiSourceExtraColumn[] {
  return extraColumnNames.map(name => ({
    name,
    expression: sourceColumns?.has(name) ? quoteIdentifier(name) : null,
  }));
}
