import { useMemo } from 'react';
import { MultiSourceExtraColumn } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { useColumns } from '@/hooks/useMetadata';

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

/**
 * Top-level columns (DESCRIBE) for each selected source of a multi-source
 * search, plus the deduped union with per-column availability counts for the
 * add-column picker. Fixed hook slots (MAX_SEARCH_SOURCES = 5); useColumns
 * self-disables for empty slots.
 */
export function useMultiSourceColumns(sources: TSource[]): {
  columnsBySourceId: Map<string, Set<string>>;
  unionColumns: MultiSourceColumnOption[];
} {
  const q0 = useColumns(columnsParamsFor(sources[0]));
  const q1 = useColumns(columnsParamsFor(sources[1]));
  const q2 = useColumns(columnsParamsFor(sources[2]));
  const q3 = useColumns(columnsParamsFor(sources[3]));
  const q4 = useColumns(columnsParamsFor(sources[4]));

  return useMemo(() => {
    const slotData = [q0.data, q1.data, q2.data, q3.data, q4.data];
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
  }, [q0.data, q1.data, q2.data, q3.data, q4.data, sources]);
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
