import {
  DashboardFilter,
  Filter,
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import api from '@/api';
import { FilterState } from '@/searchFilters';

import useDashboardFilters from '../useDashboardFilters';
import usePresetDashboardFilters from '../usePresetDashboardFilters';

// Mock the api module
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    usePresetDashboardFilters: jest.fn(),
    useCreatePresetDashboardFilter: jest.fn(),
    useUpdatePresetDashboardFilter: jest.fn(),
    useDeletePresetDashboardFilter: jest.fn(),
  },
}));

// Mock the useDashboardFilters hook
jest.mock('../useDashboardFilters', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('usePresetDashboardFilters', () => {
  const mockSourceId = 'test-service-id';
  const mockPresetDashboard = PresetDashboard.Services;

  const mockFilters: PresetDashboardFilter[] = [
    {
      id: 'filter-1',
      type: 'QUERY_EXPRESSION',
      name: 'Environment',
      expression: 'environment',
      source: mockSourceId,
      presetDashboard: PresetDashboard.Services,
    },
    {
      id: 'filter-2',
      type: 'QUERY_EXPRESSION',
      name: 'Status Code',
      expression: 'status_code',
      source: mockSourceId,
      presetDashboard: PresetDashboard.Services,
    },
  ];

  const mockFilterValues: FilterState = {
    environment: {
      included: new Set(['production']),
      excluded: new Set(),
    },
  };

  const mockFilterQueries: Filter[] = [
    {
      type: 'sql',
      condition: "environment = 'production'",
    },
  ];

  let mockRefetch: jest.Mock;
  let mockCreateMutate: jest.Mock;
  let mockUpdateMutate: jest.Mock;
  let mockDeleteMutate: jest.Mock;
  let mockSetFilterValue: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockRefetch = jest.fn();
    mockCreateMutate = jest.fn();
    mockUpdateMutate = jest.fn();
    mockDeleteMutate = jest.fn();
    mockSetFilterValue = jest.fn();

    // Mock usePresetDashboardFilters query
    jest.mocked(api.usePresetDashboardFilters).mockReturnValue({
      data: mockFilters,
      refetch: mockRefetch,
    } as any);

    // Mock create mutation
    jest.mocked(api.useCreatePresetDashboardFilter).mockReturnValue({
      mutate: mockCreateMutate,
    } as any);

    // Mock update mutation
    jest.mocked(api.useUpdatePresetDashboardFilter).mockReturnValue({
      mutate: mockUpdateMutate,
    } as any);

    // Mock delete mutation
    jest.mocked(api.useDeletePresetDashboardFilter).mockReturnValue({
      mutate: mockDeleteMutate,
    } as any);

    // Mock useDashboardFilters
    jest.mocked(useDashboardFilters).mockReturnValue({
      filterValues: mockFilterValues,
      setFilterValue: mockSetFilterValue,
      filterQueries: mockFilterQueries,
      setFilterQueries: jest.fn(),
    });
  });

  it('should initialize with filters from API', () => {
    const { result } = renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
      }),
    );

    expect(result.current.filters).toEqual(mockFilters);
    expect(api.usePresetDashboardFilters).toHaveBeenCalledWith(
      PresetDashboard.Services,
      mockSourceId,
      true,
    );
  });

  it('should return empty array when no data is available', () => {
    jest.mocked(api.usePresetDashboardFilters).mockReturnValue({
      data: undefined,
      refetch: mockRefetch,
    } as any);

    const { result } = renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
      }),
    );

    expect(result.current.filters).toEqual([]);
  });

  it('should pass the enabled status usePresetDashboardFilters when enabled is false', () => {
    renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
        enabled: false,
      }),
    );

    expect(api.usePresetDashboardFilters).toHaveBeenCalledWith(
      PresetDashboard.Services,
      mockSourceId,
      false,
    );
  });

  it('should pass the enabled status usePresetDashboardFilters when enabled is true', () => {
    renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
        enabled: true,
      }),
    );

    expect(api.usePresetDashboardFilters).toHaveBeenCalledWith(
      PresetDashboard.Services,
      mockSourceId,
      true,
    );
  });

  it('should pass the enabled status usePresetDashboardFilters when enabled is undefined', () => {
    renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
      }),
    );

    expect(api.usePresetDashboardFilters).toHaveBeenCalledWith(
      PresetDashboard.Services,
      mockSourceId,
      true,
    );
  });

  it('should pass filters to useDashboardFilters', () => {
    renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
      }),
    );

    expect(useDashboardFilters).toHaveBeenCalledWith(mockFilters);
  });

  it('should pass empty array to useDashboardFilters when no data', () => {
    jest.mocked(api.usePresetDashboardFilters).mockReturnValue({
      data: undefined,
      refetch: mockRefetch,
    } as any);

    renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
      }),
    );

    expect(useDashboardFilters).toHaveBeenCalledWith([]);
  });

  it('should return filter values and queries from useDashboardFilters', () => {
    const { result } = renderHook(() =>
      usePresetDashboardFilters({
        presetDashboard: mockPresetDashboard,
        sourceId: mockSourceId,
      }),
    );

    expect(result.current.filterValues).toEqual(mockFilterValues);
    expect(result.current.filterQueries).toEqual(mockFilterQueries);
    expect(result.current.setFilterValue).toBe(mockSetFilterValue);
  });

  describe('handleSaveFilter', () => {
    it('should create a new filter when it does not exist', () => {
      const { result } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const newFilter: DashboardFilter = {
        id: 'new-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Region',
        expression: 'region',
        source: mockSourceId,
      };

      act(() => {
        result.current.handleSaveFilter(newFilter);
      });

      expect(mockCreateMutate).toHaveBeenCalledWith(
        {
          ...newFilter,
          presetDashboard: mockPresetDashboard,
        },
        { onSuccess: expect.any(Function), onError: expect.any(Function) },
      );
      expect(mockUpdateMutate).not.toHaveBeenCalled();
    });

    it('should update an existing filter when it exists', () => {
      const { result } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const updatedFilter: DashboardFilter = {
        id: 'filter-1',
        type: 'QUERY_EXPRESSION',
        name: 'Environment (Updated)',
        expression: 'environment',
        source: mockSourceId,
      };

      act(() => {
        result.current.handleSaveFilter(updatedFilter);
      });

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        {
          ...updatedFilter,
          presetDashboard: mockPresetDashboard,
        },
        { onSuccess: expect.any(Function), onError: expect.any(Function) },
      );
      expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('should call refetch on successful create', () => {
      const { result } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const newFilter: DashboardFilter = {
        id: 'new-filter',
        type: 'QUERY_EXPRESSION',
        name: 'Region',
        expression: 'region',
        source: mockSourceId,
      };

      act(() => {
        result.current.handleSaveFilter(newFilter);
      });

      // Get the onSuccess callback that was passed to mutate
      const onSuccess = mockCreateMutate.mock.calls[0][1].onSuccess;

      // Call it to simulate successful mutation
      act(() => {
        onSuccess();
      });

      expect(mockRefetch).toHaveBeenCalled();
    });

    it('should call refetch on successful update', () => {
      const { result } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const updatedFilter: DashboardFilter = {
        id: 'filter-1',
        type: 'QUERY_EXPRESSION',
        name: 'Environment (Updated)',
        expression: 'environment',
        source: mockSourceId,
      };

      act(() => {
        result.current.handleSaveFilter(updatedFilter);
      });

      // Get the onSuccess callback that was passed to mutate
      const onSuccess = mockUpdateMutate.mock.calls[0][1].onSuccess;

      // Call it to simulate successful mutation
      act(() => {
        onSuccess();
      });

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('handleRemoveFilter', () => {
    it('should call delete mutation with correct parameters', () => {
      const { result } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const filterIdToRemove = 'filter-1';

      act(() => {
        result.current.handleRemoveFilter(filterIdToRemove);
      });

      expect(mockDeleteMutate).toHaveBeenCalledWith(
        {
          id: filterIdToRemove,
          presetDashboard: mockPresetDashboard,
        },
        { onSuccess: expect.any(Function), onError: expect.any(Function) },
      );
    });

    it('should call refetch on successful delete', () => {
      const { result } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const filterIdToRemove = 'filter-1';

      act(() => {
        result.current.handleRemoveFilter(filterIdToRemove);
      });

      // Get the onSuccess callback that was passed to mutate
      const onSuccess = mockDeleteMutate.mock.calls[0][1].onSuccess;

      // Call it to simulate successful mutation
      act(() => {
        onSuccess();
      });

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('hook dependencies', () => {
    it('should use correct preset dashboard value', () => {
      renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: PresetDashboard.Services,
          sourceId: mockSourceId,
        }),
      );

      expect(api.usePresetDashboardFilters).toHaveBeenCalledWith(
        PresetDashboard.Services,
        mockSourceId,
        true,
      );
    });

    it('should maintain stable callbacks on re-render', () => {
      const { result, rerender } = renderHook(() =>
        usePresetDashboardFilters({
          presetDashboard: mockPresetDashboard,
          sourceId: mockSourceId,
        }),
      );

      const firstHandleSaveFilter = result.current.handleSaveFilter;
      const firstHandleRemoveFilter = result.current.handleRemoveFilter;

      rerender();

      expect(result.current.handleSaveFilter).toBe(firstHandleSaveFilter);
      expect(result.current.handleRemoveFilter).toBe(firstHandleRemoveFilter);
    });
  });
});
