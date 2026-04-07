import { useCallback, useMemo, useState } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import {
  DashboardContainer,
  DashboardFilter,
  Filter,
  SavedChartConfig,
  SearchConditionLanguage,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hashCode } from '@/utils';

import { hdxServer } from './api';
import { IS_LOCAL_MODE } from './config';
import { createEntityStore } from './localStore';

// TODO: Move to types
export type Tile = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: SavedChartConfig;
  containerId?: string;
};

export type Dashboard = {
  id: string;
  name: string;
  tiles: Tile[];
  tags: string[];
  filters?: DashboardFilter[];
  savedQuery?: string | null;
  savedQueryLanguage?: SearchConditionLanguage | null;
  savedFilterValues?: Filter[];
  containers?: DashboardContainer[];
  createdAt?: string;
  updatedAt?: string;
  createdBy?: { email: string; name?: string };
  updatedBy?: { email: string; name?: string };
};

const localDashboards = createEntityStore<Dashboard>('hdx-local-dashboards');

async function fetchDashboards(): Promise<Dashboard[]> {
  if (IS_LOCAL_MODE) {
    return localDashboards.getAll();
  }
  return hdxServer('dashboards').json<Dashboard[]>();
}

export function useUpdateDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      dashboard: Partial<Dashboard> & { id: Dashboard['id'] },
    ) => {
      if (IS_LOCAL_MODE) {
        const { id, ...updates } = dashboard;
        localDashboards.update(id, updates);
        return;
      }
      await hdxServer(`dashboards/${dashboard.id}`, {
        method: 'PATCH',
        json: dashboard,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });
}

export function useCreateDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dashboard: Omit<Dashboard, 'id'>) => {
      if (IS_LOCAL_MODE) {
        return localDashboards.create(dashboard);
      }
      return hdxServer('dashboards', {
        method: 'POST',
        json: dashboard,
      }).json<Dashboard>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });
}

export function useDashboards() {
  return useQuery({
    queryKey: ['dashboards'],
    queryFn: fetchDashboards,
  });
}

export function useDashboard({
  dashboardId,
  presetConfig,
}: {
  dashboardId?: string;
  presetConfig?: Dashboard;
}) {
  const defaultDashboard = useMemo(() => {
    return (
      presetConfig ?? {
        id: '',
        name: 'My New Dashboard',
        tiles: [],
        tags: [],
      }
    );
  }, [presetConfig]);

  const [localDashboard, setLocalDashboard] = useQueryState(
    'dashboard',
    parseAsJson<Dashboard>(),
  );

  const updateDashboard = useUpdateDashboard();

  const { data: remoteDashboard, isFetching: isFetchingRemoteDashboard } =
    useQuery({
      queryKey: ['dashboards'],
      queryFn: fetchDashboards,
      select: data => {
        return data.find(d => d.id === dashboardId);
      },
      enabled: dashboardId != null,
    });

  const [isSetting, setIsSettingDashboard] = useState(false);

  const isLocalDashboard = dashboardId == null;

  const dashboard: Dashboard | undefined = useMemo(() => {
    if (isLocalDashboard) {
      return localDashboard ?? defaultDashboard;
    }
    return remoteDashboard;
  }, [isLocalDashboard, localDashboard, defaultDashboard, remoteDashboard]);

  const setDashboard = useCallback(
    (
      newDashboard: Dashboard,
      onSuccess?: VoidFunction,
      onError?: VoidFunction,
    ) => {
      if (isLocalDashboard) {
        setLocalDashboard(newDashboard);
        onSuccess?.();
      } else {
        setIsSettingDashboard(true);
        return updateDashboard.mutate(newDashboard, {
          onSuccess: () => {
            setIsSettingDashboard(false);
            onSuccess?.();
          },
          onError: e => {
            setIsSettingDashboard(false);
            notifications.show({
              color: 'red',
              title: 'Unable to save dashboard',
              message: e.message.slice(0, 100),
              autoClose: 5000,
            });
            onError?.();
          },
        });
      }
    },
    [isLocalDashboard, setLocalDashboard, updateDashboard],
  );

  const dashboardHash =
    dashboardId != null
      ? dashboardId
      : hashCode(`${JSON.stringify(dashboard)}`);

  return {
    dashboard,
    setDashboard,
    dashboardHash,
    isLocalDashboard,
    isFetching: isFetchingRemoteDashboard,
    isSetting,
  };
}

export function fetchLocalDashboards(): Dashboard[] {
  return localDashboards.getAll();
}

export function getLocalDashboardTags(): string[] {
  const tagSet = new Set<string>();
  localDashboards
    .getAll()
    .forEach(d => (d.tags ?? []).forEach(t => tagSet.add(t)));
  return Array.from(tagSet);
}

export function useDeleteDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      if (IS_LOCAL_MODE) {
        localDashboards.delete(id);
        return Promise.resolve();
      }
      return hdxServer(`dashboards/${id}`, { method: 'DELETE' }).json<void>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });
}
