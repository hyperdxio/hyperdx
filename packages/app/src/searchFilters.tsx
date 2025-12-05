import React from 'react';
import produce from 'immer';
import type { Filter } from '@hyperdx/common-utils/dist/types';

import { useLocalStorage } from './utils';

export type FilterState = {
  [key: string]: {
    included: Set<string>;
    excluded: Set<string>;
    range?: { min: number; max: number }; // For BETWEEN conditions
  };
};

export const filtersToQuery = (
  filters: FilterState,
  { stringifyKeys = false }: { stringifyKeys?: boolean } = {},
): Filter[] => {
  return Object.entries(filters)
    .filter(
      ([_, values]) =>
        values.included.size > 0 ||
        values.excluded.size > 0 ||
        values.range != null,
    )
    .flatMap(([key, values]) => {
      const conditions = [];
      const actualKey = stringifyKeys ? `toString(${key})` : key;

      if (values.included.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} IN (${Array.from(values.included)
            .map(v => `'${v}'`)
            .join(', ')})`,
        });
      }
      if (values.excluded.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} NOT IN (${Array.from(values.excluded)
            .map(v => `'${v}'`)
            .join(', ')})`,
        });
      }
      if (values.range != null) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} BETWEEN ${values.range.min} AND ${values.range.max}`,
        });
      }
      return conditions;
    });
};

export const areFiltersEqual = (a: FilterState, b: FilterState) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!b[key]) return false;

    // Check included values
    if (a[key].included.size !== b[key].included.size) return false;
    for (const value of a[key].included) {
      if (!b[key].included.has(value)) return false;
    }

    // Check excluded values
    if (a[key].excluded.size !== b[key].excluded.size) return false;
    for (const value of a[key].excluded) {
      if (!b[key].excluded.has(value)) return false;
    }

    // Check range
    if (a[key].range?.min !== b[key].range?.min) return false;
    if (a[key].range?.max !== b[key].range?.max) return false;
  }

  return true;
};

// Helper function to split on commas while respecting quoted strings
function splitValuesOnComma(valuesStr: string): string[] {
  const values: string[] = [];
  let currentValue = '';
  let inString = false;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (char === "'" && (i === 0 || valuesStr[i - 1] !== '\\')) {
      inString = !inString;
      currentValue += char;
      continue;
    }

    if (!inString && char === ',') {
      if (currentValue.trim()) {
        // Remove surrounding quotes if present
        const trimmed = currentValue.trim();
        const unquoted =
          trimmed.startsWith("'") && trimmed.endsWith("'")
            ? trimmed.slice(1, -1)
            : trimmed;
        values.push(unquoted);
      }
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  // Add the last value
  if (currentValue.trim()) {
    const trimmed = currentValue.trim();
    const unquoted =
      trimmed.startsWith("'") && trimmed.endsWith("'")
        ? trimmed.slice(1, -1)
        : trimmed;
    values.push(unquoted);
  }

  return values;
}

// Helper function to extract simple IN/NOT IN clauses from a condition
// This handles both simple conditions and compound conditions with AND
function extractInClauses(condition: string): Array<{
  key: string;
  values: string[];
  isExclude: boolean;
}> {
  const results: Array<{
    key: string;
    values: string[];
    isExclude: boolean;
  }> = [];

  // Split on ' AND ' while respecting quoted strings
  const parts: string[] = [];
  let currentPart = '';
  let inString = false;

  for (let i = 0; i < condition.length; i++) {
    const char = condition[i];

    if (char === "'" && (i === 0 || condition[i - 1] !== '\\')) {
      inString = !inString;
      currentPart += char;
      continue;
    }

    if (!inString && condition.slice(i, i + 5).toUpperCase() === ' AND ') {
      if (currentPart.trim()) {
        parts.push(currentPart.trim());
      }
      currentPart = '';
      i += 4; // Skip past ' AND '
      continue;
    }

    currentPart += char;
  }

  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  // Process each part to extract IN/NOT IN clauses
  for (const part of parts) {
    // Skip parts that contain OR (not supported) or comparison operators
    if (
      part.toUpperCase().includes(' OR ') ||
      part.includes('=') ||
      part.includes('<') ||
      part.includes('>')
    ) {
      continue;
    }

    const isExclude = part.includes('NOT IN');

    // Check if this is an IN clause
    if (part.includes(' IN ') || part.includes(' NOT IN ')) {
      const [key, values] = part.split(isExclude ? ' NOT IN ' : ' IN ');

      if (key && values) {
        const keyStr = key.trim();
        // Remove outer parentheses and split on commas while respecting quotes
        const trimmedValues = values.trim();
        const withoutParens =
          trimmedValues.startsWith('(') && trimmedValues.endsWith(')')
            ? trimmedValues.slice(1, -1)
            : trimmedValues;

        const valuesArray = splitValuesOnComma(withoutParens);

        results.push({
          key: keyStr,
          values: valuesArray,
          isExclude,
        });
      }
    }
  }

  return results;
}

export const parseQuery = (
  q: Filter[],
): {
  filters: FilterState;
} => {
  const state = new Map<
    string,
    {
      included: Set<string>;
      excluded: Set<string>;
      range?: { min: number; max: number };
    }
  >();
  for (const filter of q) {
    if (filter.type !== 'sql') continue;

    // Check for BETWEEN condition
    if (filter.condition.includes(' BETWEEN ')) {
      const betweenMatch = filter.condition.match(
        /^(.+?)\s+BETWEEN\s+(.+?)\s+AND\s+(.+?)$/i,
      );
      if (betweenMatch) {
        const [, key, minVal, maxVal] = betweenMatch;
        const keyStr = key.trim();
        const min = parseFloat(minVal.trim());
        const max = parseFloat(maxVal.trim());

        if (!state.has(keyStr)) {
          state.set(keyStr, {
            included: new Set(),
            excluded: new Set(),
            range: { min, max },
          });
        } else {
          const existing = state.get(keyStr)!;
          existing.range = { min, max };
        }
        continue;
      }
    }

    // Extract all simple IN/NOT IN clauses from the condition
    // This handles both simple conditions and compound conditions with AND/OR
    const inClauses = extractInClauses(filter.condition);

    for (const clause of inClauses) {
      if (!state.has(clause.key)) {
        state.set(clause.key, { included: new Set(), excluded: new Set() });
      }
      const sets = state.get(clause.key)!;
      clause.values.forEach(v => {
        if (clause.isExclude) {
          sets.excluded.add(v);
        } else {
          sets.included.add(v);
        }
      });
    }
  }
  return { filters: Object.fromEntries(state) };
};

export const useSearchPageFilterState = ({
  searchQuery = [],
  onFilterChange,
}: {
  searchQuery?: Filter[];
  onFilterChange: (filters: Filter[]) => void;
}) => {
  const parsedQuery = React.useMemo(() => {
    try {
      return parseQuery(searchQuery);
    } catch (e) {
      console.error(e);
      return { filters: {} };
    }
  }, [searchQuery]);

  const [filters, setFilters] = React.useState<FilterState>({});

  React.useEffect(() => {
    if (!areFiltersEqual(filters, parsedQuery.filters)) {
      setFilters(parsedQuery.filters);
    }
    // only react to changes in parsed query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedQuery.filters]);

  const updateFilterQuery = React.useCallback(
    (newFilters: FilterState) => {
      onFilterChange(filtersToQuery(newFilters));
    },
    [onFilterChange],
  );

  const setFilterValue = React.useCallback(
    (
      property: string,
      value: string,
      action?: 'only' | 'exclude' | 'include',
    ) => {
      setFilters(prevFilters => {
        const newFilters = produce(prevFilters, draft => {
          if (!draft[property]) {
            draft[property] = { included: new Set(), excluded: new Set() };
          }

          if (action === 'only') {
            draft[property] = {
              included: new Set([value]),
              excluded: new Set(),
            };
            return;
          }

          if (action === 'exclude') {
            // Remove from included if it was there
            draft[property].included.delete(value);
            // Toggle in excluded
            if (draft[property].excluded.has(value)) {
              draft[property].excluded.delete(value);
            } else {
              draft[property].excluded.add(value);
            }
            return;
          }

          // Regular toggle (include)
          draft[property].excluded.delete(value);
          if (draft[property].included.has(value)) {
            draft[property].included.delete(value);
          } else {
            draft[property].included.add(value);
          }
        });
        updateFilterQuery(newFilters);
        return newFilters;
      });
    },
    [updateFilterQuery],
  );

  const setFilterRange = React.useCallback(
    (property: string, range: { min: number; max: number }) => {
      setFilters(prevFilters => {
        const newFilters = produce(prevFilters, draft => {
          if (!draft[property]) {
            draft[property] = { included: new Set(), excluded: new Set() };
          }
          draft[property].range = range;
        });
        updateFilterQuery(newFilters);
        return newFilters;
      });
    },
    [updateFilterQuery],
  );

  const clearFilter = React.useCallback(
    (property: string) => {
      setFilters(prevFilters => {
        const newFilters = produce(prevFilters, draft => {
          delete draft[property];
        });
        updateFilterQuery(newFilters);
        return newFilters;
      });
    },
    [updateFilterQuery],
  );

  const clearAllFilters = React.useCallback(() => {
    setFilters(() => ({}));
    updateFilterQuery({});
  }, [updateFilterQuery]);

  return {
    filters,
    setFilters,
    setFilterValue,
    setFilterRange,
    clearFilter,
    clearAllFilters,
  };
};

type PinnedFilters = {
  [key: string]: string[];
};

export type FilterStateHook = ReturnType<typeof useSearchPageFilterState>;

function usePinnedFilterBySource(sourceId: string | null) {
  // Keep the original structure for backwards compatibility
  const [_pinnedFilters, _setPinnedFilters] = useLocalStorage<{
    [sourceId: string]: PinnedFilters;
  }>('hdx-pinned-search-filters', {});

  // Separate storage for pinned fields
  const [_pinnedFields, _setPinnedFields] = useLocalStorage<{
    [sourceId: string]: string[];
  }>('hdx-pinned-fields', {});

  const pinnedFilters = React.useMemo<PinnedFilters>(
    () =>
      !sourceId || !_pinnedFilters[sourceId] ? {} : _pinnedFilters[sourceId],
    [_pinnedFilters, sourceId],
  );

  const pinnedFields = React.useMemo<string[]>(
    () =>
      !sourceId || !_pinnedFields[sourceId] ? [] : _pinnedFields[sourceId],
    [_pinnedFields, sourceId],
  );

  const setPinnedFilters = React.useCallback<
    (val: PinnedFilters | ((pf: PinnedFilters) => PinnedFilters)) => void
  >(
    val => {
      if (!sourceId) return;
      _setPinnedFilters(prev =>
        produce(prev, draft => {
          draft[sourceId] =
            val instanceof Function ? val(draft[sourceId] ?? {}) : val;
        }),
      );
    },
    [sourceId, _setPinnedFilters],
  );

  const setPinnedFields = React.useCallback<
    (val: string[] | ((pf: string[]) => string[])) => void
  >(
    val => {
      if (!sourceId) return;
      _setPinnedFields(prev =>
        produce(prev, draft => {
          draft[sourceId] =
            val instanceof Function ? val(draft[sourceId] ?? []) : val;
        }),
      );
    },
    [sourceId, _setPinnedFields],
  );

  return { pinnedFilters, setPinnedFilters, pinnedFields, setPinnedFields };
}

export function usePinnedFilters(sourceId: string | null) {
  const { pinnedFilters, setPinnedFilters, pinnedFields, setPinnedFields } =
    usePinnedFilterBySource(sourceId);

  const toggleFilterPin = React.useCallback(
    (property: string, value: string) => {
      setPinnedFilters(prevFilters =>
        produce(prevFilters, draft => {
          if (!draft[property]) {
            draft[property] = [];
          }
          const idx = draft[property].findIndex(v => v === value);
          if (idx >= 0) {
            draft[property].splice(idx, 1);
          } else {
            draft[property].push(value);
          }
          return draft;
        }),
      );

      // When pinning a value, also pin the field if not already pinned
      setPinnedFields(prevFields => {
        if (!prevFields.includes(property)) {
          return [...prevFields, property];
        }
        return prevFields;
      });
    },
    [setPinnedFilters, setPinnedFields],
  );

  const toggleFieldPin = React.useCallback(
    (field: string) => {
      setPinnedFields(prevFields => {
        const fieldIndex = prevFields.findIndex(f => f === field);
        if (fieldIndex >= 0) {
          return prevFields.filter((_, i) => i !== fieldIndex);
        } else {
          return [...prevFields, field];
        }
      });
    },
    [setPinnedFields],
  );

  const isFilterPinned = React.useCallback(
    (property: string, value: string): boolean => {
      return (
        pinnedFilters[property] &&
        pinnedFilters[property].some(v => v === value)
      );
    },
    [pinnedFilters],
  );

  const isFieldPinned = React.useCallback(
    (field: string): boolean => {
      return pinnedFields.includes(field);
    },
    [pinnedFields],
  );

  const getPinnedFields = React.useCallback((): string[] => {
    return pinnedFields;
  }, [pinnedFields]);

  return {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    getPinnedFields,
    pinnedFilters,
  };
}
