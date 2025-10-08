import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import useDashboardFilters from '../useDashboardFilters';

// TODO: Re-enable tests after nuqs is upgraded to support unit testing
// https://github.com/47ng/nuqs/issues/259
describe.skip('useDashboardFilters', () => {
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

  it('should initialize with empty filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    expect(result.current.filterValues).toEqual({});
    expect(result.current.filterQueries).toEqual([]);
  });

  it('should set filter values correctly', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', 'production');
    });

    expect(result.current.filterValues).toEqual({
      filter1: 'production',
    });
  });

  it('should set multiple filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', 'production');
      result.current.setFilterValue('filter2', 'api-service');
    });

    expect(result.current.filterValues).toEqual({
      filter1: 'production',
      filter2: 'api-service',
    });
  });

  it('should remove filter value when set to null', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', 'production');
      result.current.setFilterValue('filter2', 'api-service');
    });

    act(() => {
      result.current.setFilterValue('filter1', null);
    });

    expect(result.current.filterValues).toEqual({
      filter2: 'api-service',
    });
  });

  it('should convert filter values to SQL filters', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', 'production');
      result.current.setFilterValue('filter2', 'api-service');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment = 'production'",
      },
      {
        type: 'sql',
        condition: "service.name = 'api-service'",
      },
    ]);
  });

  it('should handle numeric filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter3', '200');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "status_code = '200'",
      },
    ]);
  });

  it('should ignore filter values for non-existent filters', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', 'production');
      result.current.setFilterValue('nonexistent', 'value');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment = 'production'",
      },
    ]);
  });

  it('should update SQL filters when filter values change', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters));

    act(() => {
      result.current.setFilterValue('filter1', 'staging');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment = 'staging'",
      },
    ]);

    act(() => {
      result.current.setFilterValue('filter1', 'production');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment = 'production'",
      },
    ]);
  });

  it('should maintain filter values when filters array changes', () => {
    const newFilters: DashboardFilter[] = [
      ...mockFilters,
      {
        id: 'filter4',
        type: 'QUERY_EXPRESSION',
        name: 'Region',
        expression: 'region',
        source: 'logs',
      },
    ];

    const { result, rerender } = renderHook(
      ({ filters }) => useDashboardFilters(filters),
      {
        initialProps: { filters: mockFilters },
      },
    );

    act(() => {
      result.current.setFilterValue('filter1', 'production');
    });

    expect(result.current.filterValues).toEqual({
      filter1: 'production',
    });

    rerender({ filters: newFilters });

    expect(result.current.filterValues).toEqual({
      filter1: 'production',
    });
  });
});
