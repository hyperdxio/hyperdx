import { enableMapSet } from 'immer';
import { Filter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import {
  parseQuery,
  replaceFiltersInWhereClause,
  useSearchPageFilterState,
  whereToFilters,
} from '@/searchFilters';

// Filter state stores values in Sets; the app enables immer's MapSet plugin at
// startup, but this isolated hook test must enable it explicitly.
enableMapSet();

// Stable reference so the hook's parsed-query effect does not re-run and reset
// local filter state between renders (the empty default is a new array each
// render).
const EMPTY_SEARCH_QUERY: Filter[] = [];

describe('useSearchPageFilterState replaceFilterValue', () => {
  it('swaps an included value for a new one, preserving included polarity', () => {
    const onFilterChange = jest.fn();
    const { result } = renderHook(() =>
      useSearchPageFilterState({
        searchQuery: EMPTY_SEARCH_QUERY,
        onFilterChange,
        knownColumns: new Set(),
      }),
    );

    act(() => {
      result.current.setFilterValue('status', '200');
    });
    act(() => {
      result.current.replaceFilterValue('status', '200', '404', 'include');
    });

    expect([...result.current.filters.status.included]).toEqual(['404']);
    expect([...result.current.filters.status.excluded]).toEqual([]);
  });

  it('swaps an excluded value for a new one, preserving excluded polarity', () => {
    const onFilterChange = jest.fn();
    const { result } = renderHook(() =>
      useSearchPageFilterState({
        searchQuery: EMPTY_SEARCH_QUERY,
        onFilterChange,
        knownColumns: new Set(),
      }),
    );

    act(() => {
      result.current.setFilterValue('status', '500', 'exclude');
    });
    act(() => {
      result.current.replaceFilterValue('status', '500', '502', 'exclude');
    });

    expect([...result.current.filters.status.excluded]).toEqual(['502']);
    expect([...result.current.filters.status.included]).toEqual([]);
  });

  it('emits onFilterChange exactly once per replace', () => {
    const onFilterChange = jest.fn();
    const { result } = renderHook(() =>
      useSearchPageFilterState({
        searchQuery: EMPTY_SEARCH_QUERY,
        onFilterChange,
        knownColumns: new Set(),
      }),
    );

    act(() => {
      result.current.setFilterValue('status', '200');
    });
    onFilterChange.mockClear();
    act(() => {
      result.current.replaceFilterValue('status', '200', '404', 'include');
    });

    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });
});

describe('canonical key escaping at the persistence boundary', () => {
  // In-memory FilterState keys stay clean (what the sidebar/comparisons use);
  // the persisted Filter[] handed to onFilterChange (URL + saved search) carries
  // the canonical backtick-quoted/bracket ClickHouse key.

  describe('parseQuery stays verbatim (no key transformation)', () => {
    it('keeps an already-quoted leading key as-is', () => {
      const result = parseQuery([
        { type: 'sql', condition: "`service-name` IN ('a')" },
      ]);
      expect(result.filters).toEqual({
        '`service-name`': { included: new Set(['a']), excluded: new Set() },
      });
    });

    it('keeps a dot-form key as-is (dashboards rely on verbatim keys)', () => {
      const result = parseQuery([
        { type: 'sql', condition: "service.name IN ('a')" },
      ]);
      expect(result.filters).toEqual({
        'service.name': { included: new Set(['a']), excluded: new Set() },
      });
    });
  });

  describe('useSearchPageFilterState', () => {
    // Stable references so the hook's parsed-query effect doesn't reset local
    // filter state between renders.
    const HYPHEN_COLUMNS = new Set(['service-name']);
    const MAP_COLUMNS = new Set(['my-map']);
    const PLAIN_COLUMNS = new Set(['ServiceName']);

    it('keeps the FilterState key clean but emits a quoted key to the URL', () => {
      const onFilterChange = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: EMPTY_SEARCH_QUERY,
          onFilterChange,
          knownColumns: HYPHEN_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue('service-name', 'a');
      });

      // in-memory: clean
      expect(Object.keys(result.current.filters)).toEqual(['service-name']);
      // persisted: canonical/escaped
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: "`service-name` IN ('a')" },
      ]);
    });

    it('escapes a Map sub-key (quoted root) for the persisted query only', () => {
      const onFilterChange = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: EMPTY_SEARCH_QUERY,
          onFilterChange,
          knownColumns: MAP_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue("my-map['k']", 'v');
      });

      expect(Object.keys(result.current.filters)).toEqual(["my-map['k']"]);
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: "`my-map`['k'] IN ('v')" },
      ]);
    });

    it('leaves a plain column unquoted in both forms', () => {
      const onFilterChange = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: EMPTY_SEARCH_QUERY,
          onFilterChange,
          knownColumns: PLAIN_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue('ServiceName', 'a');
      });

      expect(Object.keys(result.current.filters)).toEqual(['ServiceName']);
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: "ServiceName IN ('a')" },
      ]);
    });

    it('unescapes a quoted key loaded from the URL back into clean FilterState', () => {
      const onFilterChange = jest.fn();
      const searchQuery: Filter[] = [
        { type: 'sql', condition: "`service-name` IN ('a')" },
      ];
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery,
          onFilterChange,
          knownColumns: HYPHEN_COLUMNS,
        }),
      );

      expect(Object.keys(result.current.filters)).toEqual(['service-name']);
      expect([...result.current.filters['service-name'].included]).toEqual([
        'a',
      ]);
    });
  });
});

describe('whereToFilters', () => {
  it('derives SQL filters from a lucene where clause', () => {
    expect(whereToFilters('host:"a"', 'lucene', new Set())).toEqual([
      { type: 'sql', condition: "host IN ('a')" },
    ]);
  });

  it('derives SQL filters from a sql where clause', () => {
    expect(whereToFilters("host IN ('a', 'b')", 'sql', new Set())).toEqual([
      { type: 'sql', condition: "host IN ('a', 'b')" },
    ]);
  });

  it('projects only facet clauses, dropping free text', () => {
    expect(whereToFilters('error 404 host:"a"', 'lucene', new Set())).toEqual([
      { type: 'sql', condition: "host IN ('a')" },
    ]);
  });

  it('quotes special-character columns via knownColumns', () => {
    expect(
      whereToFilters('service-name:"a"', 'lucene', new Set(['service-name'])),
    ).toEqual([{ type: 'sql', condition: "`service-name` IN ('a')" }]);
  });

  it('emits map sub-keys in canonical bracket form', () => {
    expect(
      whereToFilters(
        'LogAttributes.host.name:"x"',
        'lucene',
        new Set(['LogAttributes']),
      ),
    ).toEqual([
      { type: 'sql', condition: "LogAttributes['host.name'] IN ('x')" },
    ]);
  });
});

describe('replaceFiltersInWhereClause', () => {
  it('rewrites a lucene facet clause while preserving free text', () => {
    const where = 'host:"a" AND error';
    const filters: Filter[] = [{ type: 'sql', condition: "host IN ('b')" }];
    expect(
      replaceFiltersInWhereClause(where, 'lucene', filters, new Set()),
    ).toBe('error AND host:"b"');
  });

  it('rewrites a sql facet conjunct while preserving other conjuncts', () => {
    const where = "host IN ('a') AND foo = 1";
    const filters: Filter[] = [{ type: 'sql', condition: "host IN ('b')" }];
    expect(replaceFiltersInWhereClause(where, 'sql', filters, new Set())).toBe(
      "foo = 1 AND host IN ('b')",
    );
  });

  it('emits a fresh clause when the where is empty', () => {
    const filters: Filter[] = [{ type: 'sql', condition: "host IN ('b')" }];
    expect(replaceFiltersInWhereClause('', 'lucene', filters, new Set())).toBe(
      'host:"b"',
    );
  });

  it('wraps OR residual in parens before appending AND facet (Lucene OR semantics)', () => {
    // When the residual (non-facet content) contains a top-level OR, appending
    // new facet clauses with AND would change semantics without parenthesization.
    // e.g. `error OR warn` residual + `level:"error"` → `(error OR warn) AND level:"error"`
    // not `error OR warn AND level:"error"` (which parses as `error OR (warn AND level:"error")`)
    const where = 'error OR warn';
    // No facet fields in this query, so replace with a fresh level filter.
    // The residual `error OR warn` must be wrapped in parens.
    const filters: Filter[] = [{ type: 'sql', condition: "level IN ('error')" }];
    const result = replaceFiltersInWhereClause(
      where,
      'lucene',
      filters,
      new Set(),
    );
    expect(result).toBe('(error  OR warn) AND level:"error"');
  });

  it('replaces lowercase sql facet (case-insensitive detection)', () => {
    // lowercase `in` should still be recognised as a facet and replaced
    const where = "host in ('a') AND foo = 1";
    const filters: Filter[] = [{ type: 'sql', condition: "host IN ('b')" }];
    expect(replaceFiltersInWhereClause(where, 'sql', filters, new Set())).toBe(
      "foo = 1 AND host IN ('b')",
    );
  });
});
