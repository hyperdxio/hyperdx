import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import useDashboardFilters from '../useDashboardFilters';

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

  it('should generate lucene condition for multi-select values', () => {
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
      '(environment:"production" OR environment:"staging")',
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

  it('should match bracket-notation expressions after Lucene round-trip', () => {
    const bracketFilters: DashboardFilter[] = [
      {
        id: 'filter-bracket',
        type: 'QUERY_EXPRESSION',
        name: 'Pod',
        expression: "SpanAttributes['k8s.pod.name']",
        source: 'traces',
      },
    ];

    const { result } = renderHook(() => useDashboardFilters(bracketFilters));

    act(() => {
      result.current.setFilterValue("SpanAttributes['k8s.pod.name']", [
        'pod-1',
      ]);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(bracketFilters),
    );

    // The bracket-notation expression should still match after the Lucene
    // round-trip converts the key to dot notation internally.
    expect(
      result2.current.filterValues["SpanAttributes['k8s.pod.name']"]?.included,
    ).toEqual(new Set(['pod-1']));
    expect(result2.current.ignoredFilterExpressions).toEqual([]);
  });

  it('should match dot-notation URL key to bracket-notation expression', () => {
    const bracketFilters: DashboardFilter[] = [
      {
        id: 'filter-bracket',
        type: 'QUERY_EXPRESSION',
        name: 'Pod',
        expression: "SpanAttributes['k8s.pod.name']",
        source: 'traces',
      },
    ];

    // Pre-seed URL state with a dot-notation Lucene filter (as would be
    // stored after a round-trip through filtersToQuery → parseQuery).
    mockState = [
      {
        type: 'lucene',
        condition: 'SpanAttributes.k8s.pod.name:"pod-1"',
      },
    ];

    const { result } = renderHook(() => useDashboardFilters(bracketFilters));

    expect(
      result.current.filterValues["SpanAttributes['k8s.pod.name']"]?.included,
    ).toEqual(new Set(['pod-1']));
    expect(result.current.ignoredFilterExpressions).toEqual([]);
  });

  it('should migrate legacy SQL filters to Lucene on load', () => {
    // Pre-seed URL with old-format SQL filters
    mockState = [{ type: 'sql', condition: "environment IN ('production')" }];

    renderHook(() => useDashboardFilters(mockFilters));

    // Migration should have called setFilterQueries with Lucene format
    expect(mockSetState).toHaveBeenCalled();
    const lastCall =
      mockSetState.mock.calls[mockSetState.mock.calls.length - 1];
    // setFilterQueries receives an updater or a value; resolve it
    const result =
      typeof lastCall[0] === 'function' ? lastCall[0](mockState) : lastCall[0];
    expect(result).toEqual([
      { type: 'lucene', condition: 'environment:"production"' },
    ]);
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
      { type: 'lucene', condition: 'environment:"production"' },
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
      mockState = [{ type: 'lucene', condition: 'environment:"staging"' }];

      const { result } = renderHook(() =>
        useDashboardFilters(constantFilters, { savedFilterValues }),
      );

      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
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
    });
  });
});
