import {
  DashboardFilter,
  DashboardFilterValue,
  Filter,
  QueryExpressionDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import useDashboardFilters from '@/hooks/useDashboardFilters';

// Mock nuqs useQueryState with a simple useState-like implementation
let mockState: DashboardFilterValue[] | null = null;
const mockSetState = jest.fn(
  (
    updater:
      | DashboardFilterValue[]
      | null
      | ((
          prev: DashboardFilterValue[] | null,
        ) => DashboardFilterValue[] | null),
  ) => {
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
  const mockFilters: QueryExpressionDashboardFilter[] = [
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

  const selectionFor = (
    result: { current: ReturnType<typeof useDashboardFilters> },
    filterId: string,
  ) => result.current.selectionByFilterId.get(filterId);

  const conditionsFor = (queries: Filter[]) =>
    queries.map(q => ('condition' in q ? q.condition : ''));

  beforeEach(() => {
    mockState = null;
    mockSetState.mockClear();
  });

  it('should initialize with empty filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    expect(result.current.selectionByFilterId.size).toBe(0);
    expect(result.current.broadcastedFilters).toEqual([]);
  });

  it('should set a single filter value', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production']);
    });

    // Re-render to pick up the new mockState
    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(selectionFor(result2, 'filter1')?.included).toEqual(
      new Set(['production']),
    );
  });

  it('should set multiple values for a single filter (multi-select)', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production', 'staging']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(selectionFor(result2, 'filter1')?.included).toEqual(
      new Set(['production', 'staging']),
    );
  });

  it('should generate IN clause for multi-select values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production', 'staging']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(conditionsFor(result2.current.broadcastedFilters)).toEqual([
      "toString(environment) IN ('production', 'staging')",
    ]);
  });

  it('should clear filter when set to empty array', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production']);
    });
    act(() => {
      result.current.setFilterValue('filter1', []);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(selectionFor(result2, 'filter1')).toBeUndefined();
    expect(result2.current.broadcastedFilters).toEqual([]);
  });

  it('should support multi-select on multiple expressions simultaneously', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production', 'staging']);
    });
    act(() => {
      result.current.setFilterValue('filter2', ['api', 'web']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(selectionFor(result2, 'filter1')?.included).toEqual(
      new Set(['production', 'staging']),
    );
    expect(selectionFor(result2, 'filter2')?.included).toEqual(
      new Set(['api', 'web']),
    );
    expect(result2.current.broadcastedFilters).toHaveLength(2);
  });

  it('should replace previous multi-select values when updated', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production', 'staging']);
    });
    act(() => {
      result.current.setFilterValue('filter1', ['development']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(selectionFor(result2, 'filter1')?.included).toEqual(
      new Set(['development']),
    );
  });

  it('should ignore a write targeting a filter the dashboard does not declare', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production']);
    });
    act(() => {
      result.current.setFilterValue('nonexistent', ['value']);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(Array.from(result2.current.selectionByFilterId.keys())).toEqual([
      'filter1',
    ]);
  });

  it('should clear one filter without affecting others', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', ['production', 'staging']);
    });
    act(() => {
      result.current.setFilterValue('filter2', ['api']);
    });
    act(() => {
      result.current.setFilterValue('filter1', []);
    });

    const { result: result2 } = renderHook(() =>
      useDashboardFilters(mockFilters),
    );

    expect(selectionFor(result2, 'filter1')).toBeUndefined();
    expect(selectionFor(result2, 'filter2')?.included).toEqual(
      new Set(['api']),
    );
  });

  describe('getFilterQueriesForSource', () => {
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
      expect(selectionFor(result, 'filter1')?.included).toEqual(
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

    it('applies a variable-enabled filter reading a variable-keyed entry', () => {
      mockState = [{ type: 'variable', name: 'env', values: ['production'] }];
      const filters: DashboardFilter[] = [
        {
          ...mockFilters[0],
          isVariableEnabled: true,
          variableName: 'env',
          appliesToSourceIds: ['logs'],
        },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(
        conditionsFor(result.current.getFilterQueriesForSource('logs')),
      ).toEqual(["toString(environment) IN ('production')"]);
      expect(result.current.getFilterQueriesForSource('traces')).toEqual([]);
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

      expect(conditionsFor(result.current.broadcastedFilters)).toEqual([
        "toString(service.name) IN ('api')",
      ]);
      // Preset dashboards never persist the field, so they keep broadcasting.
      expect(Array.from(result.current.selectionByFilterId.keys())).toEqual([
        'filter1',
        'filter2',
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
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isVariableEnabled: true, variableName: 'env' },
      ];
      const { result } = renderHook(() => useDashboardFilters(filters));

      act(() => {
        result.current.setFilterValue('filter1', [
          'staging',
          'development',
          'production',
        ]);
      });

      const { result: result2 } = renderHook(() =>
        useDashboardFilters(filters),
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
      expect(selectionFor(result, 'filter1')?.included).toEqual(
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
      expect(Array.from(result.current.selectionByFilterId.keys())).toEqual([
        'filter1',
      ]);
    });

    it('does not flag declared expressions with no URL values as ignored', () => {
      // URL is empty — every declared expression has no values, but none of
      // them should be reported as ignored since they are valid dashboard
      // filters that just happen to be unset.
      mockState = null;

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.selectionByFilterId.size).toBe(0);
      expect(result.current.ignoredFilterExpressions).toEqual([]);
    });

    it('does not flag an expression owned only by variable-enabled filters', () => {
      // A legacy expression-keyed entry aimed at a variable-enabled filter is a
      // valid back-compat entry that just applied — not an ignored one.
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters: DashboardFilter[] = [
        { ...mockFilters[0], isVariableEnabled: true, variableName: 'env' },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(result.current.ignoredFilterExpressions).toEqual([]);
      expect(result.current.ignoredVariableNames).toEqual([]);
      expect(selectionFor(result, 'filter1')?.included).toEqual(
        new Set(['production']),
      );
    });
  });

  describe('ignoredVariableNames', () => {
    const envVariableFilter: DashboardFilter = {
      ...mockFilters[0],
      isVariableEnabled: true,
      variableName: 'env',
    };

    it('is empty when every variable entry names a declared variable', () => {
      mockState = [{ type: 'variable', name: 'env', values: ['production'] }];

      const { result } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      expect(result.current.ignoredVariableNames).toEqual([]);
    });

    it('lists a variable entry naming no declared variable-enabled filter', () => {
      mockState = [
        { type: 'variable', name: 'nope', values: ['x'] },
        { type: 'variable', name: 'env', values: ['production'] },
      ];

      const { result } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      expect(result.current.ignoredVariableNames).toEqual(['nope']);
      expect(result.current.ignoredFilterExpressions).toEqual([]);
      expect(selectionFor(result, 'filter1')?.included).toEqual(
        new Set(['production']),
      );
    });

    it('treats a name matching a filter with variables turned off as orphaned', () => {
      mockState = [{ type: 'variable', name: 'Environment', values: ['x'] }];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.ignoredVariableNames).toEqual(['Environment']);
    });

    it('keeps an orphaned variable entry across a write to another filter', () => {
      mockState = [
        { type: 'variable', name: 'nope', values: ['x'] },
        { type: 'variable', name: 'env', values: ['production'] },
      ];

      const { result } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      act(() => {
        result.current.setFilterValue('filter1', ['staging']);
      });

      expect(mockState).toEqual([
        { type: 'variable', name: 'env', values: ['staging'] },
        { type: 'variable', name: 'nope', values: ['x'] },
      ]);
    });
  });

  describe('entry format', () => {
    const envVariableFilter: DashboardFilter = {
      ...mockFilters[0],
      isVariableEnabled: true,
      variableName: 'env',
    };

    it('writes a variable-keyed entry for a variable-enabled filter', () => {
      const { result } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      act(() => {
        result.current.setFilterValue('filter1', ['production']);
      });

      expect(mockState).toEqual([
        { type: 'variable', name: 'env', values: ['production'] },
      ]);
    });

    it('writes an expression-keyed entry for a filter that is not variable-enabled', () => {
      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      act(() => {
        result.current.setFilterValue('filter1', ['production']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: "environment IN ('production')" },
      ]);
    });

    it('writes an expression-keyed entry for preset-shaped filters', () => {
      // Preset dashboard filters carry no variable fields at all.
      const { result } = renderHook(() =>
        useDashboardFilters([mockFilters[1]]),
      );

      act(() => {
        result.current.setFilterValue('filter2', ['api']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: "service.name IN ('api')" },
      ]);
    });

    it('reads a legacy entry for a variable-enabled filter and migrates it on the next write', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];
      const filters = [envVariableFilter, mockFilters[1]];

      const { result } = renderHook(() => useDashboardFilters(filters));
      expect(selectionFor(result, 'filter1')?.included).toEqual(
        new Set(['production']),
      );

      // Touching a *different* filter still migrates the whole array.
      act(() => {
        result.current.setFilterValue('filter2', ['api']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: "service.name IN ('api')" },
        { type: 'variable', name: 'env', values: ['production'] },
      ]);
    });

    it('clears a variable-keyed selection without resurrecting the legacy entry', () => {
      mockState = [{ type: 'sql', condition: "environment IN ('production')" }];

      const { result } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      act(() => {
        result.current.setFilterValue('filter1', []);
      });

      expect(mockState).toEqual([]);
    });

    it('does not migrate a legacy exclusion, and does not lose it', () => {
      // `NOT IN` has no representation in the variable-keyed format.
      mockState = [
        { type: 'sql', condition: "environment NOT IN ('production')" },
      ];
      const filters = [envVariableFilter, mockFilters[1]];

      const { result } = renderHook(() => useDashboardFilters(filters));

      act(() => {
        result.current.setFilterValue('filter2', ['api']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: "environment NOT IN ('production')" },
        { type: 'sql', condition: "service.name IN ('api')" },
      ]);
    });

    it('does not migrate a legacy range, and does not lose it', () => {
      mockState = [{ type: 'sql', condition: 'environment BETWEEN 1 AND 2' }];
      const filters = [envVariableFilter, mockFilters[1]];

      const { result } = renderHook(() => useDashboardFilters(filters));

      act(() => {
        result.current.setFilterValue('filter2', ['api']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: 'environment BETWEEN 1 AND 2' },
        { type: 'sql', condition: "service.name IN ('api')" },
      ]);
    });

    it('carries an entry no scheme can represent through a write', () => {
      mockState = [
        { type: 'lucene', condition: 'level:error' },
        { type: 'sql', condition: "environment IN ('production')" },
      ];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      act(() => {
        result.current.setFilterValue('filter2', ['api']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: "environment IN ('production')" },
        { type: 'sql', condition: "service.name IN ('api')" },
        { type: 'lucene', condition: 'level:error' },
      ]);
    });

    it('does not grow the param when a filter expression cannot round-trip', () => {
      // `parseQuery` rejects a clause whose key carries a top-level comparison
      // operator, so `Duration > 1000000 IN ('v')` reads back as nothing. The
      // selection can't persist for such a filter (true before this format too),
      // but each write must still replace the dead entry rather than append to
      // it — carrying it as passthrough grew the URL by one entry per click.
      const filters: DashboardFilter[] = [
        {
          id: 'filter1',
          type: 'QUERY_EXPRESSION',
          name: 'Slow',
          expression: 'Duration > 1000000',
          source: 'logs',
        },
      ];

      for (const value of ['v0', 'v1', 'v2', 'v3']) {
        const { result } = renderHook(() => useDashboardFilters(filters));
        act(() => {
          result.current.setFilterValue('filter1', [value]);
        });
      }

      expect(mockState).toEqual([
        { type: 'sql', condition: "Duration > 1000000 IN ('v3')" },
      ]);
    });

    it('keeps a literal "true" quoted, which the legacy format cannot', () => {
      const { result } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      act(() => {
        result.current.setFilterValue('filter1', ['true']);
      });

      const { result: result2 } = renderHook(() =>
        useDashboardFilters([envVariableFilter]),
      );

      expect(mockState).toEqual([
        { type: 'variable', name: 'env', values: ['true'] },
      ]);
      expect(conditionsFor(result2.current.broadcastedFilters)).toEqual([
        "toString(environment) IN ('true')",
      ]);
    });

    it('coerces an unquoted legacy `true` to a boolean, which the variable format avoids', () => {
      // Documents the known lossiness of expression keying: an unquoted `true`
      // in the URL parses back as a JS boolean and re-renders unquoted, which
      // is a type error against a String column.
      mockState = [{ type: 'sql', condition: 'environment IN (true)' }];

      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(conditionsFor(result.current.broadcastedFilters)).toEqual([
        'toString(environment) IN (true)',
      ]);
    });
  });

  describe('two filters sharing one expression', () => {
    const sharedExpressionFilters: DashboardFilter[] = [
      {
        id: 'shared-variable',
        type: 'QUERY_EXPRESSION',
        name: 'Service A',
        expression: 'ServiceName',
        source: 'logs',
        isVariableEnabled: true,
        variableName: 'svcA',
      },
      {
        id: 'shared-plain',
        type: 'QUERY_EXPRESSION',
        name: 'Service B',
        expression: 'ServiceName',
        source: 'logs',
      },
    ];

    it('holds independent selections and emits one predicate per definition', () => {
      mockState = [
        { type: 'variable', name: 'svcA', values: ['accounting'] },
        { type: 'sql', condition: "ServiceName IN ('frontend')" },
      ];

      const { result } = renderHook(() =>
        useDashboardFilters(sharedExpressionFilters),
      );

      expect(selectionFor(result, 'shared-variable')?.included).toEqual(
        new Set(['accounting']),
      );
      expect(selectionFor(result, 'shared-plain')?.included).toEqual(
        new Set(['frontend']),
      );
      // Two independent constraints on one column AND together.
      expect(conditionsFor(result.current.broadcastedFilters)).toEqual([
        "toString(ServiceName) IN ('accounting')",
        "toString(ServiceName) IN ('frontend')",
      ]);
    });

    it('de-duplicates identical predicates from two definitions', () => {
      mockState = [{ type: 'sql', condition: "ServiceName IN ('frontend')" }];
      const filters: DashboardFilter[] = [
        { ...sharedExpressionFilters[1], id: 'a' },
        { ...sharedExpressionFilters[1], id: 'b' },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      expect(conditionsFor(result.current.broadcastedFilters)).toEqual([
        "toString(ServiceName) IN ('frontend')",
      ]);
    });

    it('writes one variable entry and one sql entry, and keeps them independent', () => {
      const { result } = renderHook(() =>
        useDashboardFilters(sharedExpressionFilters),
      );

      act(() => {
        result.current.setFilterValue('shared-variable', ['accounting']);
      });
      act(() => {
        result.current.setFilterValue('shared-plain', ['frontend']);
      });

      expect(mockState).toEqual([
        { type: 'sql', condition: "ServiceName IN ('frontend')" },
        { type: 'variable', name: 'svcA', values: ['accounting'] },
      ]);
    });

    it('lets the override win when two definitions share a variable name', () => {
      mockState = [{ type: 'variable', name: 'dupe', values: ['old'] }];
      const filters: DashboardFilter[] = [
        {
          ...sharedExpressionFilters[0],
          id: 'first',
          variableName: 'dupe',
        },
        {
          ...sharedExpressionFilters[0],
          id: 'second',
          variableName: 'dupe',
        },
      ];

      const { result } = renderHook(() => useDashboardFilters(filters));

      act(() => {
        result.current.setFilterValue('second', ['new']);
      });

      expect(mockState).toEqual([
        { type: 'variable', name: 'dupe', values: ['new'] },
      ]);
    });
  });

  describe('unsatisfiedRequiredFilters', () => {
    const required = (
      overrides: Partial<QueryExpressionDashboardFilter> = {},
    ): QueryExpressionDashboardFilter => ({
      ...mockFilters[0],
      minSelections: 1,
      ...overrides,
    });

    it('is empty when nothing is required', () => {
      const { result } = renderHook(() => useDashboardFilters(mockFilters));

      expect(result.current.unsatisfiedRequiredFilters).toEqual([]);
    });

    it('reports a required filter with no selection', () => {
      const { result } = renderHook(() =>
        useDashboardFilters([required(), mockFilters[1]]),
      );

      expect(result.current.unsatisfiedRequiredFilters.map(f => f.id)).toEqual([
        'filter1',
      ]);
    });

    it('clears once an expression-keyed value arrives', () => {
      const filters = [required()];
      const { result, rerender } = renderHook(() =>
        useDashboardFilters(filters),
      );

      act(() => {
        result.current.setFilterValue('filter1', ['prod']);
      });
      rerender();

      expect(result.current.unsatisfiedRequiredFilters).toEqual([]);
    });

    it('clears once a variable-keyed value arrives', () => {
      const filters = [
        required({ isVariableEnabled: true, variableName: 'env' }),
      ];
      const { result, rerender } = renderHook(() =>
        useDashboardFilters(filters),
      );

      act(() => {
        result.current.setFilterValue('filter1', ['prod']);
      });
      rerender();

      expect(mockState).toEqual([
        { type: 'variable', name: 'env', values: ['prod'] },
      ]);
      expect(result.current.unsatisfiedRequiredFilters).toEqual([]);
    });

    // An exclusion narrows the data but chooses nothing, so it cannot satisfy
    // "at least one value selected".
    it('still reports a filter whose only value is an exclusion', () => {
      mockState = [{ type: 'sql', condition: "environment NOT IN ('dev')" }];

      const { result } = renderHook(() => useDashboardFilters([required()]));

      expect(selectionFor(result, 'filter1')?.excluded.size).toBe(1);
      expect(result.current.unsatisfiedRequiredFilters.map(f => f.id)).toEqual([
        'filter1',
      ]);
    });

    it('reports every unsatisfied filter in declaration order', () => {
      const { result } = renderHook(() =>
        useDashboardFilters([
          required({ id: 'filter1' }),
          mockFilters[1],
          required({ ...mockFilters[2], minSelections: 1 }),
        ]),
      );

      expect(result.current.unsatisfiedRequiredFilters.map(f => f.id)).toEqual([
        'filter1',
        'filter3',
      ]);
    });
  });
});
