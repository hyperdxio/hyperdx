import React from 'react';
import produce from 'immer';
import type { Filter } from '@hyperdx/common-utils/dist/types';

import { useLocalStorage } from './utils';

export type FilterState = {
  [key: string]: {
    included: Set<string>;
    excluded: Set<string>;
  };
};

export const filtersToQuery = (
  filters: FilterState,
  { stringifyKeys = false }: { stringifyKeys?: boolean } = {},
): Filter[] => {
  return Object.entries(filters)
    .filter(
      ([_, values]) => values.included.size > 0 || values.excluded.size > 0,
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
      return conditions;
    });
};

/**
 * Convert FilterState to Lucene query text
 * Format: key:"value1" OR key:"value2" for included values
 *         -key:value1 -key:value2 for excluded values
 */
export const filtersToLuceneQuery = (filters: FilterState): string => {
  const parts: string[] = [];

  Object.entries(filters)
    .filter(
      ([_, values]) => values.included.size > 0 || values.excluded.size > 0,
    )
    .forEach(([key, values]) => {
      // Handle included values
      if (values.included.size > 0) {
        const includedArray = Array.from(values.included);
        if (includedArray.length === 1) {
          // Single value: key:"value"
          parts.push(`${key}:"${includedArray[0]}"`);
        } else {
          // Multiple values: (key:"value1" OR key:"value2")
          const orClause = includedArray.map(v => `${key}:"${v}"`).join(' OR ');
          parts.push(`(${orClause})`);
        }
      }

      // Handle excluded values
      if (values.excluded.size > 0) {
        const excludedArray = Array.from(values.excluded);
        excludedArray.forEach(v => {
          parts.push(`-${key}:${v}`);
        });
      }
    });

  return parts.join(' ');
};

/**
 * Convert FilterState to SQL WHERE clause text
 * Format: key IN ('value1', 'value2') for included values
 *         key NOT IN ('value1', 'value2') for excluded values
 */
export const filtersToSqlQuery = (filters: FilterState): string => {
  const parts: string[] = [];

  Object.entries(filters)
    .filter(
      ([_, values]) => values.included.size > 0 || values.excluded.size > 0,
    )
    .forEach(([key, values]) => {
      // Handle included values
      if (values.included.size > 0) {
        const includedArray = Array.from(values.included);
        if (includedArray.length === 1) {
          // Single value: key = 'value'
          const escapedValue = includedArray[0].replace(/'/g, "''");
          parts.push(`${key} = '${escapedValue}'`);
        } else {
          // Multiple values: key IN ('value1', 'value2')
          const valueList = includedArray
            .map(v => `'${v.replace(/'/g, "''")}'`)
            .join(', ');
          parts.push(`${key} IN (${valueList})`);
        }
      }

      // Handle excluded values
      if (values.excluded.size > 0) {
        const excludedArray = Array.from(values.excluded);
        if (excludedArray.length === 1) {
          // Single value: key != 'value'
          const escapedValue = excludedArray[0].replace(/'/g, "''");
          parts.push(`${key} != '${escapedValue}'`);
        } else {
          // Multiple values: key NOT IN ('value1', 'value2')
          const valueList = excludedArray
            .map(v => `'${v.replace(/'/g, "''")}'`)
            .join(', ');
          parts.push(`${key} NOT IN (${valueList})`);
        }
      }
    });

  return parts.join(' AND ');
};

/**
 * Parse SQL WHERE clause back into FilterState
 * Extracts simple conditions like field = 'value', field IN (...), field != 'value', field NOT IN (...)
 */
export const parseSqlToFilters = (sql: string): FilterState => {
  const filters: FilterState = {};
  if (!sql || !sql.trim()) {
    return filters;
  }

  try {
    const text = sql.trim();

    // Match field IN ('val1', 'val2', ...)
    const inMatches = text.matchAll(/(\w+)\s+IN\s*\(([^)]+)\)/gi);
    for (const match of inMatches) {
      const field = match[1];
      const values = match[2]
        .split(',')
        .map(v => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
        .filter(v => v);

      if (!filters[field]) {
        filters[field] = { included: new Set(), excluded: new Set() };
      }
      values.forEach(v => filters[field].included.add(v));
    }

    // Match field NOT IN ('val1', 'val2', ...)
    const notInMatches = text.matchAll(/(\w+)\s+NOT\s+IN\s*\(([^)]+)\)/gi);
    for (const match of notInMatches) {
      const field = match[1];
      const values = match[2]
        .split(',')
        .map(v => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
        .filter(v => v);

      if (!filters[field]) {
        filters[field] = { included: new Set(), excluded: new Set() };
      }
      values.forEach(v => filters[field].excluded.add(v));
    }

    // Match field = 'value' (handle escaped quotes as '')
    const eqMatches = text.matchAll(/(\w+)\s*=\s*'((?:[^']|'')*)'/g);
    for (const match of eqMatches) {
      const field = match[1];
      const value = match[2].replace(/''/g, "'");

      if (!filters[field]) {
        filters[field] = { included: new Set(), excluded: new Set() };
      }
      filters[field].included.add(value);
    }

    // Match field != 'value' (handle escaped quotes as '')
    const neqMatches = text.matchAll(/(\w+)\s*!=\s*'((?:[^']|'')*)'/g);
    for (const match of neqMatches) {
      const field = match[1];
      const value = match[2].replace(/''/g, "'");

      if (!filters[field]) {
        filters[field] = { included: new Set(), excluded: new Set() };
      }
      filters[field].excluded.add(value);
    }

    return filters;
  } catch (error) {
    console.warn('Failed to parse SQL to filters:', error);
    return {};
  }
};

/**
 * Parse Lucene query back into FilterState
 * Extracts simple conditions like field:"value", (field:"val1" OR field:"val2"), -field:value
 */
export const parseLuceneToFilters = (lucene: string): FilterState => {
  const filters: FilterState = {};
  if (!lucene || !lucene.trim()) {
    return filters;
  }

  try {
    const text = lucene.trim();

    // Match grouped OR conditions: (field:"val1" OR field:"val2" OR ...)
    const orGroupMatches = text.matchAll(/\(([^)]+)\)/g);
    for (const match of orGroupMatches) {
      const group = match[1];
      // Check if this is an OR group with same field
      const fieldMatches = group.matchAll(/(\w+):"([^"]*)"/g);
      const conditions: { field: string; value: string }[] = [];

      for (const fieldMatch of fieldMatches) {
        conditions.push({ field: fieldMatch[1], value: fieldMatch[2] });
      }

      // If all conditions are for the same field, treat as included values
      if (conditions.length > 0) {
        const field = conditions[0].field;
        if (conditions.every(c => c.field === field)) {
          if (!filters[field]) {
            filters[field] = { included: new Set(), excluded: new Set() };
          }
          conditions.forEach(c => filters[field].included.add(c.value));
        }
      }
    }

    // Match negated fields: -field:"value" or -field:value
    const negatedQuotedMatches = text.matchAll(/-(\w+):"([^"]*)"/g);
    for (const match of negatedQuotedMatches) {
      const field = match[1];
      const value = match[2];

      if (!filters[field]) {
        filters[field] = { included: new Set(), excluded: new Set() };
      }
      filters[field].excluded.add(value);
    }

    const negatedUnquotedMatches = text.matchAll(/-(\w+):([^\s:"()]+)/g);
    for (const match of negatedUnquotedMatches) {
      const field = match[1];
      const value = match[2];

      if (!filters[field]) {
        filters[field] = { included: new Set(), excluded: new Set() };
      }
      filters[field].excluded.add(value);
    }

    // Match single field:"value" (not already captured in OR groups or negations)
    // Use negative lookbehind to exclude negated fields
    const singleQuotedMatches = text.matchAll(/(?<![-(\w])(\w+):"([^"]*)"/g);
    for (const match of singleQuotedMatches) {
      const field = match[1];
      const value = match[2];

      // Skip if already added from OR group
      if (!filters[field] || filters[field].included.size === 0) {
        if (!filters[field]) {
          filters[field] = { included: new Set(), excluded: new Set() };
        }
        filters[field].included.add(value);
      }
    }

    return filters;
  } catch (error) {
    console.warn('Failed to parse Lucene to filters:', error);
    return {};
  }
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
  }

  return true;
};

export const parseQuery = (
  q: Filter[],
): {
  filters: FilterState;
} => {
  const state = new Map<
    string,
    { included: Set<string>; excluded: Set<string> }
  >();
  for (const filter of q) {
    if (filter.type !== 'sql') continue;

    const isExclude = filter.condition.includes('NOT IN');
    const [key, values] = filter.condition.split(
      isExclude ? ' NOT IN ' : ' IN ',
    );
    const keyStr = key.trim();
    const valuesStr = values
      .replace('(', '')
      .replace(')', '')
      .split(',')
      .map(v => v.trim().replace(/'/g, ''));

    if (!state.has(keyStr)) {
      state.set(keyStr, { included: new Set(), excluded: new Set() });
    }
    const sets = state.get(keyStr)!;
    valuesStr.forEach(v => {
      if (isExclude) {
        sets.excluded.add(v);
      } else {
        sets.included.add(v);
      }
    });
  }
  return { filters: Object.fromEntries(state) };
};

export const useSearchPageFilterState = ({
  searchQuery = [],
  onFilterChange,
  onSearchBarUpdate,
  whereLanguage = 'lucene',
  whereQuery = '',
}: {
  searchQuery?: Filter[];
  onFilterChange: (filters: Filter[]) => void;
  onSearchBarUpdate?: (query: string) => void;
  whereLanguage?: 'sql' | 'lucene';
  whereQuery?: string;
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

  // Track the last search bar query to detect manual changes
  const lastWhereQueryRef = React.useRef<string>(whereQuery);

  React.useEffect(() => {
    if (
      !areFiltersEqual(filters, parsedQuery.filters) &&
      Object.values(parsedQuery.filters).length > 0
    ) {
      setFilters(parsedQuery.filters);
    }
    // only react to changes in parsed query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedQuery.filters]);

  // Sync filters from search bar when user manually edits it
  React.useEffect(() => {
    // Only update if the search bar query actually changed
    if (whereQuery === lastWhereQueryRef.current) {
      return;
    }
    lastWhereQueryRef.current = whereQuery;

    // Parse the search bar text back into filters
    const parsedFilters =
      whereLanguage === 'sql'
        ? parseSqlToFilters(whereQuery)
        : parseLuceneToFilters(whereQuery);

    // Only update if the parsed filters are different from current state
    // Use a callback to get the latest filters state
    setFilters(currentFilters => {
      if (!areFiltersEqual(currentFilters, parsedFilters)) {
        return parsedFilters;
      }
      return currentFilters;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereQuery, whereLanguage]);

  const updateFilterQuery = React.useCallback(
    (newFilters: FilterState) => {
      onFilterChange(filtersToQuery(newFilters));
      // Update search bar with query text if callback provided
      if (onSearchBarUpdate) {
        const queryText =
          whereLanguage === 'sql'
            ? filtersToSqlQuery(newFilters)
            : filtersToLuceneQuery(newFilters);
        onSearchBarUpdate(queryText);
      }
    },
    [onFilterChange, onSearchBarUpdate, whereLanguage],
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
  };
}
