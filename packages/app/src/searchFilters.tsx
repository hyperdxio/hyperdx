import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import produce from 'immer';
import type { Filter } from '@hyperdx/common-utils/dist/types';

import {
  type PinnedFiltersApiResponse,
  usePinnedFiltersApi,
  useUpdatePinnedFilters,
} from './pinnedFilters';

export const IS_ROOT_SPAN_COLUMN_NAME = 'isRootSpan';

export type FilterState = {
  [key: string]: {
    included: Set<string | boolean>;
    excluded: Set<string | boolean>;
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
            .map(v =>
              typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v,
            )
            .join(', ')})`,
        });
      }
      if (values.excluded.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} NOT IN (${Array.from(values.excluded)
            .map(v =>
              typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v,
            )
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

// Helper function to parse a string value as boolean if possible, or otherwise
// return as string with surrounding quotes removed and SQL-escaped quotes unescaped.
const getBooleanOrUnquotedString = (value: string): string | boolean => {
  const trimmed = value.trim();

  if (['true', 'false'].includes(trimmed.toLowerCase())) {
    return trimmed.toLowerCase() === 'true';
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

// Helper function to split on commas while respecting quoted strings and booleans.
// Handles SQL-escaped single quotes ('') inside quoted strings.
function splitValuesOnComma(valuesStr: string): (string | boolean)[] {
  const values: (string | boolean)[] = [];
  let currentValue = '';
  let inString = false;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (char === "'") {
      if (inString && i + 1 < valuesStr.length && valuesStr[i + 1] === "'") {
        // SQL-escaped quote ('') inside a string — keep both chars
        currentValue += "''";
        i++;
        continue;
      }
      inString = !inString;
      currentValue += char;
      continue;
    }

    if (!inString && char === ',') {
      if (currentValue.trim()) {
        values.push(getBooleanOrUnquotedString(currentValue));
      }
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  // Add the last value
  if (currentValue.trim()) {
    values.push(getBooleanOrUnquotedString(currentValue));
  }

  return values;
}

// Helper function to extract simple IN/NOT IN clauses from a condition
// This handles both simple conditions and compound conditions with AND
function extractInClauses(condition: string): Array<{
  key: string;
  values: (string | boolean)[];
  isExclude: boolean;
}> {
  const results: Array<{
    key: string;
    values: (string | boolean)[];
    isExclude: boolean;
  }> = [];

  // Split on ' AND ' while respecting quoted strings (including SQL-escaped quotes)
  const parts: string[] = [];
  let currentPart = '';
  let inString = false;

  for (let i = 0; i < condition.length; i++) {
    const char = condition[i];

    if (char === "'") {
      if (inString && i + 1 < condition.length && condition[i + 1] === "'") {
        currentPart += "''";
        i++;
        continue;
      }
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
      included: Set<string | boolean>;
      excluded: Set<string | boolean>;
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
  const parsedQuery = useMemo(() => {
    try {
      return parseQuery(searchQuery);
    } catch (e) {
      console.error(e);
      return { filters: {} };
    }
  }, [searchQuery]);

  const [filters, setFilters] = useState<FilterState>({});

  useEffect(() => {
    if (!areFiltersEqual(filters, parsedQuery.filters)) {
      setFilters(parsedQuery.filters);
    }
    // only react to changes in parsed query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedQuery.filters]);

  const updateFilterQuery = useCallback(
    (newFilters: FilterState) => {
      onFilterChange(filtersToQuery(newFilters));
    },
    [onFilterChange],
  );

  const setFilterValue = useCallback(
    (
      property: string,
      value: string | boolean,
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

  const setFilterRange = useCallback(
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

  const clearFilter = useCallback(
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

  const clearAllFilters = useCallback(() => {
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
  [key: string]: (string | boolean)[];
};

export type FilterStateHook = ReturnType<typeof useSearchPageFilterState>;

/**
 * Merge team-level and personal pinned filter data into a single view.
 * Fields and filter values are unioned (deduplicated).
 */
function mergePinnedData(
  team: PinnedFiltersApiResponse['team'],
  personal: PinnedFiltersApiResponse['personal'],
): { fields: string[]; filters: PinnedFilters } {
  const teamFields = team?.fields ?? [];
  const personalFields = personal?.fields ?? [];
  const fields = [...new Set([...teamFields, ...personalFields])];

  const teamFilters = team?.filters ?? {};
  const personalFilters = personal?.filters ?? {};
  const allKeys = new Set([
    ...Object.keys(teamFilters),
    ...Object.keys(personalFilters),
  ]);

  const filters: PinnedFilters = {};
  for (const key of allKeys) {
    const teamVals = teamFilters[key] ?? [];
    const personalVals = personalFilters[key] ?? [];
    // Deduplicate using string comparison (values are strings or booleans)
    const merged = [...teamVals];
    for (const v of personalVals) {
      if (!merged.some(existing => existing === v)) {
        merged.push(v);
      }
    }
    filters[key] = merged;
  }

  return { fields, filters };
}

/**
 * Migrate pinned filters from localStorage to the server.
 * Reads the old localStorage keys and pushes them as team-level pins,
 * then clears the localStorage entries for that source.
 */
function useLocalStorageMigration(
  sourceId: string | null,
  apiData: PinnedFiltersApiResponse | undefined,
  updateMutation: ReturnType<typeof useUpdatePinnedFilters>,
) {
  const hasMigratedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sourceId || !apiData || hasMigratedRef.current.has(sourceId)) return;

    // Only migrate if server has no team-level data yet
    if (apiData.team != null) {
      hasMigratedRef.current.add(sourceId);
      return;
    }

    try {
      const storedFiltersRaw = window.localStorage.getItem(
        'hdx-pinned-search-filters',
      );
      const storedFieldsRaw = window.localStorage.getItem('hdx-pinned-fields');

      const storedFilters: Record<string, PinnedFilters> = storedFiltersRaw
        ? JSON.parse(storedFiltersRaw)
        : {};
      const storedFields: Record<string, string[]> = storedFieldsRaw
        ? JSON.parse(storedFieldsRaw)
        : {};

      const filtersForSource = storedFilters[sourceId];
      const fieldsForSource = storedFields[sourceId];

      const hasLocalData =
        (filtersForSource && Object.keys(filtersForSource).length > 0) ||
        (fieldsForSource && fieldsForSource.length > 0);

      if (hasLocalData) {
        updateMutation.mutate(
          {
            source: sourceId,
            scope: 'team',
            fields: fieldsForSource ?? [],
            filters: filtersForSource ?? {},
          },
          {
            onSuccess: () => {
              // Clean up localStorage for this source after successful migration
              try {
                if (storedFiltersRaw) {
                  const updated = { ...storedFilters };
                  delete updated[sourceId];
                  window.localStorage.setItem(
                    'hdx-pinned-search-filters',
                    JSON.stringify(updated),
                  );
                }
                if (storedFieldsRaw) {
                  const updated = { ...storedFields };
                  delete updated[sourceId];
                  window.localStorage.setItem(
                    'hdx-pinned-fields',
                    JSON.stringify(updated),
                  );
                }
              } catch {
                // localStorage cleanup is best-effort
              }
            },
          },
        );
      }
    } catch {
      // Migration is best-effort — don't block the user
    }

    hasMigratedRef.current.add(sourceId);
  }, [sourceId, apiData, updateMutation]);
}

export function usePinnedFilters(sourceId: string | null) {
  const { data: apiData } = usePinnedFiltersApi(sourceId);
  const updateMutation = useUpdatePinnedFilters();

  // Migrate from localStorage on first load
  useLocalStorageMigration(sourceId, apiData, updateMutation);

  // Optimistic local state so rapid toggles don't lose changes.
  // When the user toggles a pin, we update this local state immediately,
  // then debounce the API call. The local state is the source of truth
  // until the API response comes back and resets it.
  const [optimisticTeam, setOptimisticTeam] = useState<{
    fields: string[];
    filters: PinnedFilters;
  } | null>(null);

  // When apiData changes (server response), clear optimistic state
  useEffect(() => {
    setOptimisticTeam(null);
  }, [apiData]);

  // The effective team state: optimistic if pending, otherwise from API
  const effectiveTeam = useMemo(
    () =>
      optimisticTeam ?? {
        fields: apiData?.team?.fields ?? [],
        filters: apiData?.team?.filters ?? {},
      },
    [optimisticTeam, apiData],
  );

  // Merge team + personal into a unified view for read operations
  const { fields: pinnedFields, filters: pinnedFilters } = useMemo(
    () =>
      mergePinnedData({ id: '', ...effectiveTeam }, apiData?.personal ?? null),
    [effectiveTeam, apiData?.personal],
  );

  // Debounce ref to batch rapid toggles
  const pendingUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushUpdate = useCallback(
    (newFields: string[], newFilters: PinnedFilters) => {
      if (!sourceId) return;

      // Update optimistic state immediately so the next toggle reads it
      setOptimisticTeam({ fields: newFields, filters: newFilters });

      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
      pendingUpdateRef.current = setTimeout(() => {
        updateMutation.mutate({
          source: sourceId,
          scope: 'team',
          fields: newFields,
          filters: newFilters,
        });
        pendingUpdateRef.current = null;
      }, 300);
    },
    [sourceId, updateMutation],
  );

  const toggleFilterPin = useCallback(
    (property: string, value: string | boolean) => {
      const currentFilters: PinnedFilters = { ...effectiveTeam.filters };
      const currentFields = [...effectiveTeam.fields];

      if (!currentFilters[property]) {
        currentFilters[property] = [];
      }
      const idx = currentFilters[property].findIndex(
        (v: string | boolean) => v === value,
      );
      if (idx >= 0) {
        currentFilters[property] = currentFilters[property].filter(
          (_: string | boolean, i: number) => i !== idx,
        );
        if (currentFilters[property].length === 0) {
          delete currentFilters[property];
        }
      } else {
        currentFilters[property] = [...currentFilters[property], value];
      }

      // When pinning a value, also pin the field if not already pinned
      const newFields = currentFields.includes(property)
        ? currentFields
        : [...currentFields, property];

      flushUpdate(newFields, currentFilters);
    },
    [effectiveTeam, flushUpdate],
  );

  const toggleFieldPin = useCallback(
    (field: string) => {
      const currentFields = [...effectiveTeam.fields];
      const currentFilters = { ...effectiveTeam.filters };
      const fieldIndex = currentFields.indexOf(field);
      const newFields =
        fieldIndex >= 0
          ? currentFields.filter((_, i) => i !== fieldIndex)
          : [...currentFields, field];

      flushUpdate(newFields, currentFilters);
    },
    [effectiveTeam, flushUpdate],
  );

  const isFilterPinned = useCallback(
    (property: string, value: string | boolean): boolean => {
      return (
        pinnedFilters[property] != null &&
        pinnedFilters[property].some(v => v === value)
      );
    },
    [pinnedFilters],
  );

  const isFieldPinned = useCallback(
    (field: string): boolean => {
      return pinnedFields.includes(field);
    },
    [pinnedFields],
  );

  const getPinnedFields = useCallback((): string[] => {
    return pinnedFields;
  }, [pinnedFields]);

  const resetPinnedFilters = useCallback(() => {
    flushUpdate([], {});
  }, [flushUpdate]);

  return {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    getPinnedFields,
    pinnedFilters,
    resetPinnedFilters,
  };
}
