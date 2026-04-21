import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import produce from 'immer';
import type { Filter } from '@hyperdx/common-utils/dist/types';

import { usePinnedFiltersApi, useUpdatePinnedFilters } from './pinnedFilters';
import { useLocalStorage } from './utils';

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

  // Remove surrounding quotes and un-escape '' → '
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

// Returns true when the single-quote at position `i` is a real string delimiter
// rather than an escape sequence.  Handles both ClickHouse/SQL '' escaping and
// backslash \' escaping.
function isQuoteBoundary(s: string, i: number): boolean {
  if (s[i] !== "'") return false;
  if (i > 0 && s[i - 1] === '\\') return false;
  return true;
}

// If we're inside a quoted string and hit a quote, check whether the next
// character is also a quote ('' escape).  If so, skip both and stay in the
// string.  Returns the new index to continue iteration from.
function handleQuoteEscape(
  s: string,
  i: number,
): { skip: boolean; next: number } {
  if (i + 1 < s.length && s[i + 1] === "'") {
    return { skip: true, next: i + 1 };
  }
  return { skip: false, next: i };
}

// Helper function to split on commas while respecting quoted strings and booleans.
// Handles SQL-escaped single quotes ('') inside quoted strings.
function splitValuesOnComma(valuesStr: string): (string | boolean)[] {
  const values: (string | boolean)[] = [];
  let currentValue = '';
  let inString = false;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (isQuoteBoundary(valuesStr, i)) {
      if (inString) {
        const esc = handleQuoteEscape(valuesStr, i);
        if (esc.skip) {
          currentValue += "''";
          i = esc.next;
          continue;
        }
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

// Check whether a SQL fragment contains a keyword or operator outside of
// single-quoted strings.  Accepts either single characters (=, <, >) or
// multi-character keywords (' OR ', ' BETWEEN ') to search for.
function containsOutsideQuotes(
  text: string,
  targets: (string | { char: string })[],
): boolean {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (isQuoteBoundary(text, i)) {
      if (inString) {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;

    for (const target of targets) {
      if (typeof target === 'object') {
        if (char === target.char) return true;
      } else {
        if (text.slice(i, i + target.length).toUpperCase() === target)
          return true;
      }
    }
  }
  return false;
}

function containsOperatorOutsideQuotes(part: string): boolean {
  return containsOutsideQuotes(part, [
    { char: '=' },
    { char: '<' },
    { char: '>' },
    ' OR ',
  ]);
}

// Split a string on the first occurrence of `delimiter` that is outside
// single-quoted strings.  Returns [before, after] or null if not found.
function splitOnFirstOutsideQuotes(
  text: string,
  delimiter: string,
): [string, string] | null {
  let inString = false;
  const upper = delimiter.toUpperCase();
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (isQuoteBoundary(text, i)) {
      if (inString) {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (text.slice(i, i + upper.length).toUpperCase() === upper) {
      return [text.slice(0, i), text.slice(i + upper.length)];
    }
  }
  return null;
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

    if (isQuoteBoundary(condition, i)) {
      if (inString) {
        const esc = handleQuoteEscape(condition, i);
        if (esc.skip) {
          currentPart += "''";
          i = esc.next;
          continue;
        }
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
    // Skip parts that contain OR (not supported) or comparison operators,
    // but only when those operators appear outside of quoted strings.
    if (containsOperatorOutsideQuotes(part)) {
      continue;
    }

    const isExclude = containsOutsideQuotes(part, [' NOT IN ']);
    const hasIn = isExclude || containsOutsideQuotes(part, [' IN ']);

    if (hasIn) {
      // Split on the first unquoted ' IN ' / ' NOT IN '
      const splitResult = splitOnFirstOutsideQuotes(
        part,
        isExclude ? ' NOT IN ' : ' IN ',
      );
      if (!splitResult) continue;
      const [key, values] = splitResult;

      const keyStr = key.trim();
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

    // Check for BETWEEN condition (only when BETWEEN appears outside quotes)
    if (containsOutsideQuotes(filter.condition, [' BETWEEN '])) {
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
export function mergePinnedData(
  team: { fields: string[]; filters: PinnedFilters } | null,
  personal: { fields: string[]; filters: PinnedFilters } | null,
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
 * Toggle a value in a PinnedFilters map. Returns a new map with the value
 * added or removed under the given property key.
 */
function toggleValueInFilters(
  filters: PinnedFilters,
  property: string,
  value: string | boolean,
): PinnedFilters {
  const updated = { ...filters };
  if (!updated[property]) {
    updated[property] = [];
  }
  const idx = updated[property].findIndex((v: string | boolean) => v === value);
  if (idx >= 0) {
    updated[property] = updated[property].filter(
      (_: string | boolean, i: number) => i !== idx,
    );
    if (updated[property].length === 0) {
      delete updated[property];
    }
  } else {
    updated[property] = [...updated[property], value];
  }
  return updated;
}

/**
 * Hook for personal pinned filters stored in localStorage.
 * This is the original storage mechanism — per-user, per-browser.
 */
function usePersonalPinnedFilters(sourceId: string | null) {
  const [_pinnedFilters, _setPinnedFilters] = useLocalStorage<{
    [sourceId: string]: PinnedFilters;
  }>('hdx-pinned-search-filters', {});

  const [_pinnedFields, _setPinnedFields] = useLocalStorage<{
    [sourceId: string]: string[];
  }>('hdx-pinned-fields', {});

  const filters = useMemo<PinnedFilters>(
    () =>
      !sourceId || !_pinnedFilters[sourceId] ? {} : _pinnedFilters[sourceId],
    [_pinnedFilters, sourceId],
  );

  const fields = useMemo<string[]>(
    () =>
      !sourceId || !_pinnedFields[sourceId] ? [] : _pinnedFields[sourceId],
    [_pinnedFields, sourceId],
  );

  const setFilters = useCallback(
    (val: PinnedFilters | ((pf: PinnedFilters) => PinnedFilters)) => {
      if (!sourceId) return;
      _setPinnedFilters(prev => {
        const updated = { ...prev };
        updated[sourceId] =
          val instanceof Function ? val(prev[sourceId] ?? {}) : val;
        return updated;
      });
    },
    [sourceId, _setPinnedFilters],
  );

  const setFields = useCallback(
    (val: string[] | ((pf: string[]) => string[])) => {
      if (!sourceId) return;
      _setPinnedFields(prev => {
        const updated = { ...prev };
        updated[sourceId] =
          val instanceof Function ? val(prev[sourceId] ?? []) : val;
        return updated;
      });
    },
    [sourceId, _setPinnedFields],
  );

  return { filters, fields, setFilters, setFields };
}

export function usePinnedFilters(sourceId: string | null) {
  // Personal pins: localStorage (per-user, per-browser)
  const personal = usePersonalPinnedFilters(sourceId);

  // Team/shared pins: MongoDB via API (shared across team)
  const { data: teamApiData } = usePinnedFiltersApi(sourceId);
  const updateTeamMutation = useUpdatePinnedFilters();

  // Optimistic state keyed by sourceId so it is automatically ignored when
  // the source changes — no useEffect needed to clear stale state.
  const [optimisticTeam, setOptimisticTeam] = useState<{
    sourceId: string;
    fields: string[];
    filters: PinnedFilters;
  } | null>(null);

  const effectiveTeam = useMemo(
    () =>
      optimisticTeam?.sourceId === sourceId
        ? { fields: optimisticTeam.fields, filters: optimisticTeam.filters }
        : {
            fields: teamApiData?.team?.fields ?? [],
            filters: teamApiData?.team?.filters ?? {},
          },
    [optimisticTeam, sourceId, teamApiData],
  );

  // Merge team + personal into a unified view for read operations
  const { fields: pinnedFields, filters: pinnedFilters } = useMemo(
    () =>
      mergePinnedData(effectiveTeam, {
        fields: personal.fields,
        filters: personal.filters,
      }),
    [effectiveTeam, personal.fields, personal.filters],
  );

  // Debounce for team API writes — cancelled on unmount to prevent stale writes.
  const pendingTeamUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (pendingTeamUpdateRef.current) {
        clearTimeout(pendingTeamUpdateRef.current);
        pendingTeamUpdateRef.current = null;
      }
    };
  }, []);

  const flushTeamUpdate = useCallback(
    (newFields: string[], newFilters: PinnedFilters) => {
      if (!sourceId) return;

      setOptimisticTeam({ sourceId, fields: newFields, filters: newFilters });

      if (pendingTeamUpdateRef.current) {
        clearTimeout(pendingTeamUpdateRef.current);
      }
      pendingTeamUpdateRef.current = setTimeout(() => {
        updateTeamMutation.mutate(
          {
            source: sourceId,
            fields: newFields,
            filters: newFilters,
          },
          {
            onSettled: () => setOptimisticTeam(null),
          },
        );
        pendingTeamUpdateRef.current = null;
      }, 300);
    },
    [sourceId, updateTeamMutation],
  );

  // Personal pin: value-level pin (localStorage, instant)
  const toggleFilterPin = useCallback(
    (property: string, value: string | boolean) => {
      personal.setFilters(prev => toggleValueInFilters(prev, property, value));
      // When pinning a value, also pin the field if not already pinned
      personal.setFields(prev =>
        prev.includes(property) ? prev : [...prev, property],
      );
    },
    [personal],
  );

  // Personal pin: field-level pin (localStorage, instant)
  const toggleFieldPin = useCallback(
    (field: string) => {
      personal.setFields(prev => {
        const idx = prev.indexOf(field);
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, field];
      });
    },
    [personal],
  );

  // Personal-only checks (not merged) — so team pins don't show as personal
  const isFilterPinned = useCallback(
    (property: string, value: string | boolean): boolean => {
      return (
        personal.filters[property] != null &&
        personal.filters[property].some((v: string | boolean) => v === value)
      );
    },
    [personal.filters],
  );

  const isFieldPinned = useCallback(
    (field: string): boolean => {
      return personal.fields.includes(field);
    },
    [personal.fields],
  );

  // Merged view for getPinnedFields (used for sorting and always-fetch logic)
  const getPinnedFields = useCallback((): string[] => {
    return pinnedFields;
  }, [pinnedFields]);

  // Team pin: field-level (MongoDB via API, debounced)
  const toggleSharedFieldPin = useCallback(
    (field: string) => {
      const currentFields = [...effectiveTeam.fields];
      const currentFilters = { ...effectiveTeam.filters };
      const fieldIndex = currentFields.indexOf(field);

      if (fieldIndex >= 0) {
        // Removing field from shared — also clean up its filter values
        const newFields = currentFields.filter((_, i) => i !== fieldIndex);
        delete currentFilters[field];
        flushTeamUpdate(newFields, currentFilters);
      } else {
        // Adding field to shared
        flushTeamUpdate([...currentFields, field], currentFilters);
      }
    },
    [effectiveTeam, flushTeamUpdate],
  );

  const isSharedFieldPinned = useCallback(
    (field: string): boolean => {
      // A field is shared if it's in the fields list OR has shared filter values
      return (
        effectiveTeam.fields.includes(field) ||
        (effectiveTeam.filters[field] != null &&
          effectiveTeam.filters[field].length > 0)
      );
    },
    [effectiveTeam],
  );

  // Team pin: value-level (MongoDB via API, debounced)
  const toggleSharedFilterPin = useCallback(
    (property: string, value: string | boolean) => {
      const newFilters = toggleValueInFilters(
        effectiveTeam.filters,
        property,
        value,
      );
      // When sharing a value, also add the field to shared fields
      const newFields = effectiveTeam.fields.includes(property)
        ? effectiveTeam.fields
        : [...effectiveTeam.fields, property];

      flushTeamUpdate(newFields, newFilters);
    },
    [effectiveTeam, flushTeamUpdate],
  );

  const isSharedFilterPinned = useCallback(
    (property: string, value: string | boolean): boolean => {
      const vals = effectiveTeam.filters[property];
      return vals != null && vals.some(v => v === value);
    },
    [effectiveTeam],
  );

  const resetPersonalPins = useCallback(() => {
    personal.setFields(() => []);
    personal.setFilters(() => ({}));
  }, [personal]);

  const resetSharedFilters = useCallback(() => {
    flushTeamUpdate([], {});
  }, [flushTeamUpdate]);

  const hasPersonalPins = useMemo(
    () =>
      personal.fields.length > 0 || Object.keys(personal.filters).length > 0,
    [personal.fields, personal.filters],
  );

  const hasSharedPins = useMemo(
    () =>
      effectiveTeam.fields.length > 0 ||
      Object.keys(effectiveTeam.filters).length > 0,
    [effectiveTeam],
  );

  return {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    getPinnedFields,
    pinnedFilters,
    toggleSharedFieldPin,
    isSharedFieldPinned,
    toggleSharedFilterPin,
    isSharedFilterPinned,
    resetPersonalPins,
    resetSharedFilters,
    hasPersonalPins,
    hasSharedPins,
  };
}
