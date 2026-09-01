import {
  FilterState,
  filtersToQuery,
  getFilterExpression,
  getFilterVariableName,
  isFilterVariableEnabled,
  isStaticListFilter,
  parseQuery,
} from '@/filters';
import {
  DashboardFilter,
  DashboardFilterValue,
  Filter,
  VariableFilterValue,
} from '@/types';

/**
 * A dashboards filter/variable state is persisted as an array of entries in one of two
 * addressing schemes:
 *
 *  - legacy, keyed by SQL expression: `{ type: 'sql', condition: "E IN ('a')" }`
 *  - variable-keyed:                  `{ type: 'variable', name: 'svc', values: ['a'] }`
 *
 * Expression keying cannot represent two filters that share an `expression`,
 * and has nowhere to put a selection for a filter with no expression at all.
 * Variable keying fixes both, but only exists for variable-enabled filters, so
 * both schemes are accepted when reading state, and state is written in
 * variable-keyed format when possible, falling back to expression-keyed
 * format for filters that are not variable-enabled.
 */

/** One filter's selection: what a `FilterState` holds per key. */
export type FilterSelection = FilterState[string];

export type ParsedDashboardFilterValues = {
  /** Selections addressed by SQL expression, parsed via `parseQuery`. */
  byExpression: FilterState;
  /** Selections addressed by dashboard variable name. */
  byVariable: Map<string, string[]>;
  /**
   * Non-`sql` entries (`lucene`, `sql_ast`), carried verbatim so a write doesn't
   * destroy them.
   */
  passthrough: DashboardFilterValue[];
};

const isVariableEntry = (
  entry: DashboardFilterValue,
): entry is VariableFilterValue => entry.type === 'variable';

/** Split a raw entry array into the two addressing schemes + passthrough. */
export function parseDashboardFilterValues(
  entries: DashboardFilterValue[] | undefined,
): ParsedDashboardFilterValues {
  const byVariable = new Map<string, string[]>();
  const passthrough: DashboardFilterValue[] = [];
  const sqlEntries: Filter[] = [];

  for (const entry of entries ?? []) {
    if (isVariableEntry(entry)) {
      // There shouldn't be duplicate names, but if there are the first wins.
      if (!byVariable.has(entry.name)) {
        byVariable.set(entry.name, entry.values);
      }
      continue;
    }

    if (entry.type !== 'sql') {
      passthrough.push(entry);
      continue;
    }

    // `parseQuery` is lenient: it extracts the clauses it recognizes and drops
    // the rest, so an entry it understands nothing of contributes no key here.
    sqlEntries.push(entry);
  }

  return {
    // Parsed as one batch rather than merged per entry, so multiple entries on
    // one expression combine exactly as they do today.
    byExpression: parseQuery(sqlEntries).filters,
    byVariable,
    passthrough,
  };
}

/**
 * Inverse of `parseDashboardFilterValues`.
 *
 * Ordering is legacy entries, then variable entries, then passthrough — output
 * is deterministic to avoid unnecessary churn in URL query params.
 */
export function serializeDashboardFilterValues(input: {
  byExpression?: FilterState;
  byVariable?: ReadonlyMap<string, string[]>;
  passthrough?: DashboardFilterValue[];
}): DashboardFilterValue[] {
  const entries: DashboardFilterValue[] = [
    // Re-use existing filter query rendering for legacy/expression-keyed format
    ...filtersToQuery(input.byExpression ?? {}, { stringifyKeys: false }),
  ];

  for (const [name, values] of input.byVariable ?? []) {
    if (values.length === 0) continue; // Empty selections are omitted.
    entries.push({ type: 'variable', name, values });
  }

  entries.push(...(input.passthrough ?? []));

  return entries;
}

/**
 * The identity a filter's selection is stored under: its variable name when it
 * has one, otherwise its SQL expression.
 */
export function filterSelectionKey(
  filter: DashboardFilter,
):
  | { kind: 'variable'; name: string }
  | { kind: 'expression'; expression: string } {
  if (isStaticListFilter(filter)) {
    return { kind: 'variable', name: getFilterVariableName(filter) ?? '' };
  }

  if (isFilterVariableEnabled(filter)) {
    const name = getFilterVariableName(filter);
    if (name) return { kind: 'variable', name };
  }

  return { kind: 'expression', expression: filter.expression };
}

/**
 * Resolve one filter's selection out of a parsed entry array.
 *
 * A variable-keyed entry wins over an expression-keyed entry if they address
 * the same filter, including when it holds no values.
 */
export function resolveFilterSelection(
  filter: DashboardFilter,
  parsed: Pick<ParsedDashboardFilterValues, 'byExpression'> & {
    byVariable: ReadonlyMap<string, string[]>;
  },
): FilterSelection | undefined {
  const key = filterSelectionKey(filter);
  if (key.kind === 'variable') {
    const values = parsed.byVariable.get(key.name);
    if (values) {
      return {
        included: new Set<string | boolean>(values),
        excluded: new Set(),
      };
    }
  }
  const expression = getFilterExpression(filter);
  if (expression == null) return undefined;
  return new Map(Object.entries(parsed.byExpression)).get(expression);
}
