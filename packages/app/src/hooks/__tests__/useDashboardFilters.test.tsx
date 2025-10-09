import { act } from 'react';
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import useDashboardFilters from '../useDashboardFilters';

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

  it('should initialize with empty filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    expect(result.current.filterValues).toEqual({});
    expect(result.current.filterQueries).toEqual([]);
  });

  it('should set filter values correctly', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('environment', 'production');
    });

    expect(result.current.filterValues).toEqual({
      environment: {
        included: new Set(['production']),
        excluded: new Set(),
      },
    });
  });

  it('should set multiple filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('environment', 'production');
      result.current.setFilterValue('service.name', 'api-service');
    });

    expect(result.current.filterValues).toEqual({
      environment: {
        included: new Set(['production']),
        excluded: new Set(),
      },
      'service.name': {
        included: new Set(['api-service']),
        excluded: new Set(),
      },
    });
  });

  it('should remove filter value when set to null', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('environment', 'production');
      result.current.setFilterValue('service.name', 'api-service');
    });

    act(() => {
      result.current.setFilterValue('environment', null);
    });

    expect(result.current.filterValues).toEqual({
      'service.name': {
        included: new Set(['api-service']),
        excluded: new Set(),
      },
    });
  });

  it('should convert filter values to SQL filters', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('environment', 'production');
      result.current.setFilterValue('service.name', 'api-service');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment IN ('production')",
      },
      {
        type: 'sql',
        condition: "service.name IN ('api-service')",
      },
    ]);
  });

  it('should handle numeric filter values', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('status_code', '200');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "status_code IN ('200')",
      },
    ]);
  });

  it('should ignore filter values for non-existent filters', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('environment', 'production');
      result.current.setFilterValue('nonexistent', 'value');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment IN ('production')",
      },
    ]);
  });

  it('should update SQL filters when filter values change', () => {
    const { result } = renderHook(() => useDashboardFilters(mockFilters), {
      wrapper: withNuqsTestingAdapter(),
    });

    act(() => {
      result.current.setFilterValue('environment', 'staging');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment IN ('staging')",
      },
    ]);

    act(() => {
      result.current.setFilterValue('environment', 'production');
    });

    expect(result.current.filterQueries).toEqual([
      {
        type: 'sql',
        condition: "environment IN ('production')",
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
        wrapper: withNuqsTestingAdapter({
          searchParams: '?filters=[]',
          // Needed or else we get
          // Warning: Cannot update a component (`TestComponent`) while rendering a different component (`NuqsTestingAdapter`).
          resetUrlUpdateQueueOnMount: false,
        }),
      },
    );

    act(() => {
      result.current.setFilterValue('environment', 'production');
    });

    expect(result.current.filterValues).toEqual({
      environment: {
        included: new Set(['production']),
        excluded: new Set(),
      },
    });

    rerender({ filters: newFilters });

    expect(result.current.filterValues).toEqual({
      environment: {
        included: new Set(['production']),
        excluded: new Set(),
      },
    });
  });
});
