import { useCallback, useMemo } from 'react';
import {
  DashboardFilter,
  PresetDashboard,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import api from '@/api';

import useDashboardFilters from './useDashboardFilters';

export default function usePresetDashboardFilters({
  presetDashboard,
  sourceId,
  enabled = true,
}: {
  presetDashboard: PresetDashboard;
  sourceId: string;
  enabled?: boolean;
}) {
  const createDashboardFilter = api.useCreatePresetDashboardFilter();
  const updateDashboardFilter = api.useUpdatePresetDashboardFilter();
  const deleteDashboardFilter = api.useDeletePresetDashboardFilter();

  const { data, refetch, isFetching } = api.usePresetDashboardFilters(
    presetDashboard,
    sourceId || '',
    enabled,
  );

  const { filterValues, setFilterValue, filterQueries } = useDashboardFilters(
    data ?? [],
  );

  const onSuccess = useCallback(() => {
    refetch();
    notifications.show({
      message: 'Filters updated',
      color: 'green',
    });
  }, [refetch]);

  const onError = useCallback(() => {
    notifications.show({
      message: 'Error updating filters',
      color: 'red',
    });
  }, []);

  const handleSaveFilter = useCallback(
    (dashboardFilter: DashboardFilter) => {
      const presetDashboardFilter = {
        ...dashboardFilter,
        presetDashboard,
      };

      if (data?.find(f => f.id === dashboardFilter.id)) {
        updateDashboardFilter.mutate(presetDashboardFilter, {
          onSuccess,
          onError,
        });
      } else {
        createDashboardFilter.mutate(presetDashboardFilter, {
          onSuccess,
          onError,
        });
      }
    },
    [
      data,
      updateDashboardFilter,
      createDashboardFilter,
      presetDashboard,
      onSuccess,
      onError,
    ],
  );

  const handleRemoveFilter = useCallback(
    (id: string) => {
      deleteDashboardFilter.mutate(
        {
          id,
          presetDashboard,
        },
        { onSuccess, onError },
      );
    },
    [deleteDashboardFilter, presetDashboard, onSuccess, onError],
  );

  return {
    filters: data ?? [],
    filterValues,
    setFilterValue,
    filterQueries,
    handleSaveFilter,
    handleRemoveFilter,
    isFetching: isFetching,
    isMutationPending:
      createDashboardFilter.isPending ||
      updateDashboardFilter.isPending ||
      deleteDashboardFilter.isPending,
  };
}
