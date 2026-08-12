import { useMemo } from 'react';
import {
  ColumnMeta,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { MultiSourceExtraColumn } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { Filter, TSource } from '@hyperdx/common-utils/dist/types';

import { useColumns } from '@/hooks/useMetadata';
import { useMultiSourceSlots } from '@/hooks/useSourceSlots';

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
  /** Union of Date/DateTime column name → ClickHouse type across sources. */
  dateTimeColumns: Map<string, string>;
} {
  const slotData = useMultiSourceSlots(
    sources,
    useSourceColumnsSlot,
    undefined,
  );

  return useMemo(() => {
    const columnsBySourceId = new Map<string, Set<string>>();
    const availability = new Map<string, number>();
    const dateTimeColumns = new Map<string, string>();

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const columns = slotData[i];
      if (source == null || columns == null) continue;
      const names = new Set(columns.map(c => c.name));
      columnsBySourceId.set(source.id, names);
      for (const name of names) {
        availability.set(name, (availability.get(name) ?? 0) + 1);
      }
      for (const col of filterColumnMetaByType(columns, [JSDataType.Date]) ??
        []) {
        if (!dateTimeColumns.has(col.name)) {
          dateTimeColumns.set(col.name, col.type);
        }
      }
    }

    const unionColumns = [...availability.entries()]
      .map(([name, availableCount]) => ({ name, availableCount }))
      .sort(
        (a, b) =>
          b.availableCount - a.availableCount || a.name.localeCompare(b.name),
      );

    return { columnsBySourceId, unionColumns, dateTimeColumns };
  }, [slotData, sources]);
}

/**
 * The table column a reference is rooted at: `ServiceName` for `ServiceName`,
 * `LogAttributes` for `LogAttributes['level']` or `LogAttributes.level`, and
 * the unquoted name for a backticked identifier. Returns null for anything
 * that isn't rooted at a plain column (a bare function call, say), so callers
 * treat it as "can't attribute" rather than "missing".
 */
export function rootColumnOf(reference: string): string | null {
  const ref = reference.trim();
  const backticked = ref.match(/^`([^`]+)`/);
  if (backticked) return backticked[1];
  const plain = ref.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  return plain ? plain[0] : null;
}

/**
 * Root column a filter references, for per-source resolvability checks.
 * sql_ast filters carry the escaped SQL key in `left`. Other filter types
 * (raw sql/lucene conditions) can't be attributed to a single column and
 * return null — callers should apply them to every source and rely on
 * per-source error isolation.
 */
export function filterRootColumn(filter: Filter): string | null {
  if (filter.type !== 'sql_ast') return null;
  return rootColumnOf(filter.left);
}

/**
 * For one source: which of the given column references its table doesn't
 * have. A non-empty result means the source can't answer the search and
 * should be excluded, with the reason shown to the user.
 *
 * Unknown columns (null root) and an unknown column list are both treated as
 * "no reason to exclude" — better to run the query and surface a real error
 * than to drop a source on a guess.
 */
export function unresolvedColumns(
  references: (string | null)[],
  sourceColumns: Set<string> | undefined,
): string[] {
  if (sourceColumns == null) return [];
  const missing = new Set<string>();
  for (const reference of references) {
    const root = reference == null ? null : rootColumnOf(reference);
    if (root != null && !sourceColumns.has(root)) {
      missing.add(root);
    }
  }
  return [...missing];
}

/**
 * For one source: which columns the active filters reference that its table
 * doesn't have.
 */
export function unresolvedFilterColumns(
  filters: Filter[],
  sourceColumns: Set<string> | undefined,
): string[] {
  return unresolvedColumns(filters.map(filterRootColumn), sourceColumns);
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
