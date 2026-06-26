import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import useDashboardFilters from '@/hooks/useDashboardFilters';

// Mock nuqs useQueryState with a simple useState-like implementation
let mockState: Filter[] | null = null;
const mockSetState = jest.fn(
  (updater: Filter[] | null | ((prev: Filter[] | null) => Filter[] | null)) => {
    if (typeof updater === 'function') {
      mockState = updater(mockState);
    } else {
      mockState = updater;
    }
  },
);

jest.mock('nuqs', () => ({
  useQueryState: () => [mockState, mockSetState],
  createParser: (opts: { parse: Function; serialize: Function }) => opts,
}));

describe('useDashboardFilters', () => {
  const mockFilters: DashboardFilter[] = [
    {
      id: 'filter1',
      type: 'QUERY_EXPRESSION',
      name: 'Environment',
      expression: 'environment',
      source: 'logs',
    },
    {
      id: 'filter2',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'service.name',
      source: 'traces',
    },
    {
      id: 'filter3',
      type: 'QUERY_EXPRESSION',
      name: 'Status',
      expression: 'status_code',
      source: 'logs',
    },
  ];

  beforeEach(() => {
    mockState = null;
    mockSetState.mockClear();
  });

  it('should initialize with empty filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    expect(result.current.filterValues).toEqual({});
    expect(result.current.filterQueries).toEqual([]);
  });

  it('should set a single filter value', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production']);
    });

    // Re-render to pick up the new mockState
    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterValues.environment.included).toEqual(
      new Set(['production']),
    );
  });

  it('should set multiple values for a single filter (multi-select)', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production', 'staging']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterValues.environment.included).toEqual(
      new Set(['production', 'staging']),
    );
  });

  it('should generate IN clause for multi-select values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production', 'staging']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterQueries).toHaveLength(1);
    const query = result2.current.filterQueries[0];
    const condition = 'condition' in query ? query.condition : '';
    expect(condition).toEqual(
      "toString(environment) IN ('production', 'staging')",
    );
  });

  it('should clear filter when set to empty array', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production']);
    });
    act(() => {
      result.current.setFilterValue('environment', []);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterValues.environment).toBeUndefined();
    expect(result2.current.filterQueries).toEqual([]);
  });

  it('should support multi-select on multiple expressions simultaneously', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production', 'staging']);
    });
    act(() => {
      result.current.setFilterValue('service.name', ['api', 'web']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterValues.environment.included).toEqual(
      new Set(['production', 'staging']),
    );
    expect(result2.current.filterValues['service.name'].included).toEqual(
      new Set(['api', 'web']),
    );
    expect(result2.current.filterQueries).toHaveLength(2);
  });

  it('should replace previous multi-select values when updated', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production', 'staging']);
    });
    act(() => {
      result.current.setFilterValue('environment', ['development']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterValues.environment.included).toEqual(
      new Set(['development']),
    );
  });

  it('should ignore filter values for non-existent filter expressions', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production']);
    });
    act(() => {
      result.current.setFilterValue('nonexistent', ['value']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(Object.keys(result2.current.filterValues)).toEqual(['environment']);
  });

  it('should clear one filter without affecting others', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('environment', ['production', 'staging']);
    });
    act(() => {
      result.current.setFilterValue('service.name', ['api']);
    });
    act(() => {
      result.current.setFilterValue('environment', []);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(result2.current.filterValues.environment).toBeUndefined();
    expect(result2.current.filterValues['service.name'].included).toEqual(
      new Set(['api']),
    );
  });

  describe('ignoredFilterExpressions', () => {
    it('is empty when no URL filters are set', () => {
      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.ignoredFilterExpressions).toEqual([]);
    });

    it('is empty when URL filters only reference declared expressions', () => {
      mockState = [
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "service.name IN ('api')" },
      ];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.ignoredFilterExpressions).toEqual([]);
    });

    it('lists a single ignored expression not declared by the dashboard', () => {
      mockState = [
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "team IN ('platform')" },
      ];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.ignoredFilterExpressions).toEqual(['team']);
      // sanity: declared expression still wins through normal path
      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
    });

    it('lists multiple ignored expressions in URL-encounter order', () => {
      mockState = [
        { type: 'sql', condition: "team IN ('platform')" },
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "region IN ('us-east-1')" },
        { type: 'sql', condition: "owner IN ('drew')" },
      ];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.ignoredFilterExpressions).toEqual([
        'team',
        'region',
        'owner',
      ]);
      expect(Object.keys(result.current.filterValues)).toEqual(['environment']);
    });

    it('does not flag declared expressions with no URL values as ignored', () => {
      // URL is empty — every declared expression has no values, but none of
      // them should be reported as ignored since they are valid dashboard
      // filters that just happen to be unset.
      mockState = null;

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.filterValues).toEqual({});
      expect(result.current.ignoredFilterExpressions).toEqual([]);
    });
  });

  describe('constant filters (HDX-4404)', () => {
    const constantFilters: DashboardFilter[] = [
      {
        id: 'env-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs',
        constant: true,
        renderMode: 'readonly',
      },
      {
        id: 'svc-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'service.name',
        source: 'traces',
        // No constant flag; behaves like a normal editable filter.
      },
    ];

    const savedFilterValues: Filter[] = [
      { type: 'sql', condition: "environment IN ('production')" },
    ];

    it('injects the saved value for a constant filter when the URL is empty', () => {
      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );

      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
      // Sibling editable filter has no URL state, so no value is set.
      expect(result.current.filterValues['service.name']).toBeUndefined();
    });

    it('uses the saved value over any URL value on the same expression', () => {
      // The viewer or a shared link tried to override the constant filter
      // via the URL. The hook must ignore that and keep the saved value.
      mockState = [{ type: 'sql', condition: "environment IN ('staging')" }];

      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );

      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
      // A URL entry whose expression is now `constant: true` is NOT
      // surfaced as "ignored" to the caller. Surfacing it would render
      // a stale "ignored filter" banner on a cloneable template; the
      // viewer correctly sees the locked value with no warning.
      expect(result.current.ignoredFilterExpressions).toEqual([]);
    });

    it('setFilterValue is a no-op for a constant filter expression', () => {
      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );

      // Clear any setFilterQueries calls from the initial render (e.g.
      // legacy SQL migration on cold start).
      mockSetState.mockClear();

      act(() => {
        result.current.setFilterValue('environment', ['development']);
      });

      // No-op: the constant expression cannot be cleared or rewritten.
      expect(mockSetState).not.toHaveBeenCalled();
    });

    it('setFilterValue still works for editable siblings', () => {
      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );

      mockSetState.mockClear();
      act(() => {
        result.current.setFilterValue('service.name', ['api']);
      });

      expect(mockSetState).toHaveBeenCalled();
      // After the URL update, the editable filter has the new value AND
      // the constant filter still has its locked value.
      const { result: result2 } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );
      expect(result2.current.filterValues['service.name'].included).toEqual(
        new Set(['api']),
      );
      expect(result2.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
    });

    it('getFilterQueriesForSource returns the locked value for a constant filter', () => {
      // appliesToSourceIds restricts the constant to a subset of tiles.
      const scopedConstantFilter: DashboardFilter = {
        id: 'env-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs',
        constant: true,
        appliesToSourceIds: ['source-a'],
      };

      const { result } = renderHook(() =>
        useDashboardFilters([scopedConstantFilter], { savedFilterValues }),
      );

      // Tile on the in-scope source receives the locked value.
      const inScope = result.current.getFilterQueriesForSource('source-a');
      expect(inScope).toHaveLength(1);
      const inScopeCondition =
        'condition' in inScope[0] ? inScope[0].condition : '';
      expect(inScopeCondition).toContain('environment');
      expect(inScopeCondition).toContain('production');

      // Tile on an out-of-scope source receives nothing.
      const outOfScope = result.current.getFilterQueriesForSource('source-b');
      expect(outOfScope).toEqual([]);
    });

    it('resolves the locked value for a hidden filter (renderMode: hidden, constant: true)', () => {
      const hiddenFilter: DashboardFilter = {
        id: 'env-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs',
        constant: true,
        renderMode: 'hidden',
      };

      const { result } = renderHook(() =>
        useDashboardFilters([hiddenFilter], { savedFilterValues }),
      );

      // The hook applies the locked value the same way regardless of
      // renderMode. The filter bar component drops the chip elsewhere.
      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
    });

    it('resolves no value for a constant filter when savedFilterValues is missing the expression', () => {
      const constantWithoutSavedValue: DashboardFilter = {
        id: 'region-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Region',
        expression: 'region',
        source: 'logs',
        constant: true,
      };

      const { result } = renderHook(() =>
        useDashboardFilters([constantWithoutSavedValue], {
          savedFilterValues,
        }),
      );

      expect(result.current.filterValues.region).toBeUndefined();
      // No saved value AND the constant rule keeps the URL state out:
      // the per-source query layer should also see nothing for any tile.
      expect(result.current.getFilterQueriesForSource('source-a')).toEqual([]);
    });

    it('setFilterValue scrubs stale constant entries out of the URL on every write', () => {
      // A viewer landed via a shared URL that carries an entry for an
      // expression now locked by `constant: true`. Without the
      // scrubbing in setFilterValue, the next write for any sibling
      // would re-emit the stale constant entry via filtersToQuery,
      // re-publishing the locked scope back into shared links.
      mockState = [
        { type: 'sql', condition: "environment IN ('staging')" },
        { type: 'sql', condition: "service.name IN ('old')" },
      ];

      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );

      mockSetState.mockClear();
      act(() => {
        // Write for a sibling editable filter (not the constant one).
        result.current.setFilterValue('service.name', ['api']);
      });

      // setFilterValue should have been called for the editable filter.
      expect(mockSetState).toHaveBeenCalled();

      // The resulting URL state must NOT contain the stale environment
      // entry. Re-render to read the new URL state through the hook.
      const { result: result2 } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );
      expect(result2.current.filterValues['service.name'].included).toEqual(
        new Set(['api']),
      );
      // The constant filter still shows its saved value; the stale URL
      // entry for the same expression did NOT survive the write.
      expect(result2.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
      const serialized = (mockState ?? [])
        .map(f => ('condition' in f ? f.condition : ''))
        .join('|');
      expect(serialized).not.toContain('staging');
    });

    it('aggregates by normalized expression so mixed legacy siblings still resolve the locked value', () => {
      // Legacy data shape: same dashboard saved before the sibling
      // refinement landed, or via a non-v2 path that bypassed
      // validation. One sibling is `constant: true`, the other is
      // editable; both on the same expression. The hook MUST treat
      // both as locked (the saved value wins) so the editable sibling
      // cannot pull a stale URL value into the chip while
      // setFilterValue blocks the writes.
      const legacyMixedSiblings: DashboardFilter[] = [
        {
          id: 'env-locked',
          type: 'QUERY_EXPRESSION',
          name: 'Environment (locked)',
          expression: 'environment',
          source: 'logs',
          constant: true,
        },
        {
          id: 'env-editable',
          type: 'QUERY_EXPRESSION',
          name: 'Environment (editable)',
          expression: 'environment',
          source: 'logs',
          // No constant flag; the legacy editable sibling.
        },
      ];
      // Stale URL value trying to override the constant.
      mockState = [{ type: 'sql', condition: "environment IN ('staging')" }];

      const { result } = renderHook(() =>
        useDashboardFilters(legacyMixedSiblings, { savedFilterValues }),
      );

      // Both siblings see the locked value, not the URL value.
      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
    });

    it('resolves a constant filter declared with bracket-notation expression', () => {
      // Bracket-notation expressions like SpanAttributes['k8s.pod.name']
      // normalize to dot-notation on the URL/saved-value side via
      // parseKeyPath. The hook must match the locked value through that
      // normalization so a constant filter declared with brackets still
      // resolves to its saved default, and setFilterValue still no-ops.
      const bracketConstantFilter: DashboardFilter = {
        id: 'pod-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Pod',
        expression: "SpanAttributes['k8s.pod.name']",
        source: 'traces',
        constant: true,
      };

      const bracketSavedFilterValues: Filter[] = [
        {
          type: 'sql',
          condition: "SpanAttributes.k8s.pod.name IN ('api-pod-1')",
        },
      ];

      const { result } = renderHook(() =>
        useDashboardFilters([bracketConstantFilter], {
          savedFilterValues: bracketSavedFilterValues,
        }),
      );

      expect(
        result.current.filterValues["SpanAttributes['k8s.pod.name']"].included,
      ).toEqual(new Set(['api-pod-1']));

      // setFilterValue against the same bracket-notation expression must
      // also no-op (the no-op key is normalized internally).
      mockSetState.mockClear();
      act(() => {
        result.current.setFilterValue("SpanAttributes['k8s.pod.name']", [
          'other-pod',
        ]);
      });
      expect(mockSetState).not.toHaveBeenCalled();

      // getFilterQueriesForSource returns the locked value for any tile
      // (no appliesToSourceIds set).
      const queries = result.current.getFilterQueriesForSource('source-x');
      expect(queries).toHaveLength(1);
      const condition = 'condition' in queries[0] ? queries[0].condition : '';
      expect(condition).toContain('api-pod-1');
    });
  });

  describe('enabled flag (race guard, HDX-4404)', () => {
    const constantFilters: DashboardFilter[] = [
      {
        id: 'filter-svc',
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        source: 'traces',
        constant: true,
        renderMode: 'readonly',
      },
    ];

    it('returns empty filterValues + filterQueries when enabled is false', () => {
      mockState = [
        { type: 'sql', condition: "ServiceName IN ('stale-from-url')" },
      ];
      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, {
          savedFilterValues: [
            { type: 'sql', condition: "ServiceName IN ('locked-value')" },
          ],
          enabled: false,
        }),
      );

      // While the dashboard is still loading, the hook must NOT emit the
      // URL value (stale) NOR the savedFilterValues value (we don't yet
      // know which expressions are constant). It short-circuits so tile
      // queries wait for hydration.
      expect(result.current.filterValues).toEqual({});
      expect(result.current.filterQueries).toEqual([]);
      expect(result.current.getFilterQueriesForSource('source-x')).toEqual([]);
    });

    it('emits the locked value once enabled flips to true', () => {
      mockState = [
        { type: 'sql', condition: "ServiceName IN ('stale-from-url')" },
      ];
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useDashboardFilters(constantFilters, {
            savedFilterValues: [
              { type: 'sql', condition: "ServiceName IN ('locked-value')" },
            ],
            enabled,
          }),
        { initialProps: { enabled: false } },
      );
      expect(result.current.filterValues).toEqual({});

      rerender({ enabled: true });
      expect(
        result.current.filterValues['ServiceName']?.included,
      ).toBeDefined();
      const queries = result.current.getFilterQueriesForSource('source-x');
      expect(queries).toHaveLength(1);
      const condition = 'condition' in queries[0] ? queries[0].condition : '';
      expect(condition).toContain('locked-value');
      expect(condition).not.toContain('stale-from-url');
    });

    it('defaults enabled to true when option is omitted', () => {
      mockState = null;
      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, {
          savedFilterValues: [
            { type: 'sql', condition: "ServiceName IN ('locked-value')" },
          ],
        }),
      );
      // Backward compatible: callers that don't pass `enabled` get the
      // current behavior (overlay runs immediately).
      expect(
        result.current.filterValues['ServiceName']?.included,
      ).toBeDefined();
    });
  });
});
