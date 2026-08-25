import { enableMapSet } from 'immer';
import { Filter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import {
  escapeFilterStateKeys,
  parseQuery,
  useSearchPageFilterState,
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
    const JSON_COLUMNS = new Set(['ResourceAttributes']);

    it('merges JSON filter keys that escape to the same SQL expression', () => {
      expect(
        escapeFilterStateKeys(
          {
            'ResourceAttributes.k8s.namespace.name': {
              included: new Set(['production']),
              excluded: new Set<string | boolean>(),
            },
            'toString(ResourceAttributes.`k8s`.`namespace`.`name`)': {
              included: new Set(['staging']),
              excluded: new Set(['development']),
            },
          },
          JSON_COLUMNS,
          JSON_COLUMNS,
        ),
      ).toEqual({
        'toString(ResourceAttributes.`k8s`.`namespace`.`name`)': {
          included: new Set(['production', 'staging']),
          excluded: new Set(['development']),
        },
      });
    });

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

    it('uses one clean JSON key for selection and clear interactions', () => {
      const onFilterChange = jest.fn();
      const searchQuery: Filter[] = [
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('production')",
        },
      ];
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery,
          onFilterChange,
          knownColumns: JSON_COLUMNS,
          jsonColumns: JSON_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue(
          'toString(ResourceAttributes.`k8s`.`namespace`.`name`)',
          'staging',
        );
      });

      expect(result.current.filters).toEqual({
        'ResourceAttributes.k8s.namespace.name': {
          included: new Set(['production', 'staging']),
          excluded: new Set(),
        },
      });
      expect(onFilterChange).toHaveBeenLastCalledWith([
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('production', 'staging')",
        },
      ]);

      act(() => {
        result.current.clearFilter(
          'toString(ResourceAttributes.`k8s`.`namespace`.`name`)',
        );
      });

      expect(result.current.filters).toEqual({});
      expect(onFilterChange).toHaveBeenLastCalledWith([]);
    });

    it('canonicalizes a persisted Map-style JSON filter after columns load', () => {
      const onFilterChange = jest.fn();
      const onCanonicalizeFilterChange = jest.fn();
      const searchQuery: Filter[] = [
        {
          type: 'sql',
          condition:
            "ResourceAttributes['k8s.namespace.name'] IN ('production')",
        },
      ];
      const { rerender } = renderHook(
        ({ jsonColumns }: { jsonColumns: ReadonlySet<string> }) =>
          useSearchPageFilterState({
            searchQuery,
            onFilterChange,
            onCanonicalizeFilterChange,
            knownColumns: new Set(['ResourceAttributes']),
            jsonColumns,
          }),
        { initialProps: { jsonColumns: new Set<string>() } },
      );

      expect(onFilterChange).not.toHaveBeenCalled();
      expect(onCanonicalizeFilterChange).not.toHaveBeenCalled();

      rerender({ jsonColumns: new Set(['ResourceAttributes']) });

      expect(onCanonicalizeFilterChange).toHaveBeenCalledWith([
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('production')",
        },
      ]);
      expect(onFilterChange).not.toHaveBeenCalled();
    });

    it('merges stale forms of one JSON filter while canonicalizing', () => {
      const onFilterChange = jest.fn();
      const searchQuery: Filter[] = [
        {
          type: 'sql',
          condition:
            "ResourceAttributes['k8s.namespace.name'] IN ('production')",
        },
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('staging')",
        },
        { type: 'sql', condition: "ServiceName IN ('api')" },
      ];
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery,
          onFilterChange,
          knownColumns: new Set(['ResourceAttributes', 'ServiceName']),
          jsonColumns: JSON_COLUMNS,
        }),
      );

      expect(result.current.filters).toEqual({
        'ResourceAttributes.k8s.namespace.name': {
          included: new Set(['production', 'staging']),
          excluded: new Set(),
        },
        ServiceName: {
          included: new Set(['api']),
          excluded: new Set(),
        },
      });
      expect(onFilterChange).toHaveBeenCalledWith([
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('production', 'staging')",
        },
        { type: 'sql', condition: "ServiceName IN ('api')" },
      ]);
    });

    it('does not rewrite an already canonical JSON filter', () => {
      const onFilterChange = jest.fn();

      renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            {
              type: 'sql',
              condition:
                "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('production')",
            },
          ],
          onFilterChange,
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: new Set(['ResourceAttributes']),
        }),
      );

      expect(onFilterChange).not.toHaveBeenCalled();
    });

    it('preserves quoted filters that are not for JSON columns', () => {
      const onFilterChange = jest.fn();

      renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            { type: 'sql', condition: "`service-name` IN ('api')" },
          ],
          onFilterChange,
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: new Set(['ResourceAttributes']),
        }),
      );

      expect(onFilterChange).not.toHaveBeenCalled();
    });

    it('preserves embedded backticks when canonicalizing a JSON filter', () => {
      const onFilterChange = jest.fn();

      renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            {
              type: 'sql',
              condition: "ResourceAttributes['k8s.na`me'] IN ('value')",
            },
          ],
          onFilterChange,
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: new Set(['ResourceAttributes']),
        }),
      );

      expect(onFilterChange).toHaveBeenCalledWith([
        {
          type: 'sql',
          condition: "toString(ResourceAttributes.`k8s`.`na``me`) IN ('value')",
        },
      ]);
    });
  });
});
