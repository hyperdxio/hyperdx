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

  describe('getFilterQueriesForSource', () => {
    const conditionsFor = (queries: Filter[]) =>
      queries.map(q => ('condition' in q ? q.condition : ''));

    it('applies an unscoped filter to every tile', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(
        conditionsFor(result.current.getFilterQueriesForSource('logs')),
      ).toEqual(["toString(environment) IN ('production')"]);
      expect(
        conditionsFor(result.current.getFilterQueriesForSource('traces')),
      ).toEqual(["toString(environment) IN ('production')"]);
    });

    it('applies a scoped filter only to tiles on a listed source', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], appliesToSourceIds: ['logs'] },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.getFilterQueriesForSource('logs')).toHaveLength(1);
      expect(result.current.getFilterQueriesForSource('traces')).toEqual([]);
    });

    it('applies a broadcast-disabled filter to no tile', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isBroadcastEnabled: false },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.getFilterQueriesForSource('logs')).toEqual([]);
      expect(result.current.getFilterQueriesForSource('traces')).toEqual([]);
      expect(result.current.getFilterQueriesForSource(undefined)).toEqual([]);
      // The value still exists for the filter bar and for variable use.
      expect(result.current.filterValues.environment.included).toEqual(
        new Set(['production']),
      );
    });

    it('applies a broadcast-disabled filter to no tile even when it is scoped', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        {
          ...mockFilters[0],
          isBroadcastEnabled: false,
          appliesToSourceIds: ['logs'],
        },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.getFilterQueriesForSource('logs')).toEqual([]);
    });

    it('keeps broadcasting when the field is absent or explicitly true', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isBroadcastEnabled: true },
      ];

      const { result: withTrue } = renderHook(() =>
        useDashboardFilters(filters),
      );
      const { result: withMissing } = renderHook(() =>
        useDashboardFilters([mockFilters[0]]),
      );

      expect(withTrue.current.getFilterQueriesForSource('logs')).toHaveLength(
        1,
      );
      expect(
        withMissing.current.getFilterQueriesForSource('logs'),
      ).toHaveLength(1);
    });

    it('broadcasts when a sibling definition on the same expression still broadcasts', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], id: 'a', isBroadcastEnabled: false },
        {
          ...mockFilters[0],
          id: 'b',
          isBroadcastEnabled: true,
          appliesToSourceIds: ['traces'],
        },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.getFilterQueriesForSource('traces')).toHaveLength(
        1,
      );
      expect(result.current.getFilterQueriesForSource('logs')).toEqual([]);
    });
  });

  describe('filterQueries', () => {
    it('omits broadcast-disabled filters', () => {
      mockState = [
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "service.name IN ('api')" },
      ];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isBroadcastEnabled: false },
        mockFilters[1],
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.filterQueries).toHaveLength(1);
      const query = result.current.filterQueries[0];
      expect('condition' in query ? query.condition : '').toEqual(
        "toString(service.name) IN ('api')",
      );
      // Preset dashboards never persist the field, so they keep broadcasting.
      expect(Object.keys(result.current.filterValues)).toEqual([
        'environment',
        'service.name',
      ]);
    });
  });

  describe('variables', () => {
    it('is empty when no filter is variable-enabled', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.variables).toEqual([]);
    });

    it('exposes a variable-enabled filter with its expression and selection', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isVariableEnabled: true, variableName: 'env' },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.variables).toEqual([
        { name: 'env', expression: 'environment', values: ['production'] },
      ]);
    });

    it('derives the name from the filter name when none is set', () => {
      const filters: DashboardFilter[] = [
        { ...mockFilters[1], isVariableEnabled: true },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.variables).toEqual([
        { name: 'Service', expression: 'service.name', values: [] },
      ]);
    });

    it('excludes filters that are not variable-enabled', () => {
      mockState = [
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "service.name IN ('api')" },
      ];
      const filters: DashboardFilter[] = [
        mockFilters[0],
        { ...mockFilters[1], isVariableEnabled: true, variableName: 'service' },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.variables.map(v => v.name)).toEqual(['service']);
    });

    it('exposes a broadcast-disabled filter as a variable', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        {
          ...mockFilters[0],
          isBroadcastEnabled: false,
          isVariableEnabled: true,
          variableName: 'env',
        },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.getFilterQueriesForSource('logs')).toEqual([]);
      expect(result.current.variables).toEqual([
        { name: 'env', expression: 'environment', values: ['production'] },
      ]);
    });

    it('yields an empty value list when nothing is selected', () => {
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isVariableEnabled: true, variableName: 'env' },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.variables).toEqual([
        { name: 'env', expression: 'environment', values: [] },
      ]);
    });

    it('sorts values so selection order does not change the payload', () => {
      const { result } = renderHook(() =>
        useDashboardFilters([
          { ...mockFilters[0], isVariableEnabled: true, variableName: 'env' },
        ]),
      );

      act(() => {
        result.current.setFilterValue('environment', [
          'staging',
          'development',
          'production',
        ]);
      });

      const { result: result2 } = renderHook(() =>
        useDashboardFilters([
          { ...mockFilters[0], isVariableEnabled: true, variableName: 'env' },
        ]),
      );

      expect(result2.current.variables[0].values).toEqual([
        'development',
        'production',
        'staging',
      ]);
    });

    it('keeps the first definition when two share a variable name', () => {
      mockState = [
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "service.name IN ('api')" },
      ];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isVariableEnabled: true, variableName: 'dupe' },
        { ...mockFilters[1], isVariableEnabled: true, variableName: 'dupe' },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.variables).toEqual([
        { name: 'dupe', expression: 'environment', values: ['production'] },
      ]);
    });
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
});
