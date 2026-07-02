import { useCallback, useMemo, useState } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import {
  DashboardContainer,
  DashboardFilter,
  Filter,
  resolveChartPaletteToken,
  SavedChartConfig,
  SearchConditionLanguage,
  walkRawDashboardTileColors,
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
  tabId?: string;
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

/**
 * Resolution policy shared by both the typed normalizer below and the
 * `unknown`-walking JSON-import variant: hue tokens pass through
 * unchanged, legacy `chart-N` from #2265 are rewritten to their
 * hue-named equivalents, and anything else (stale hexes, hand-edited
 * values, future tokens from a forward-rolled deploy) is left as-is so
 * the strict server-side `ChartPaletteTokenSchema` surfaces a clear
 * error on save rather than silently dropping the user's chosen color.
 * Render-time consumers (`DBNumberChart`, `ColorSwatchInput`) still
 * call `resolveChartPaletteToken` directly so the live chart falls
 * back gracefully even while the unresolved value is in flight.
 */
const migrateOrPreserveColor = (current: string): string => {
  const resolved = resolveChartPaletteToken(current);
  return resolved ?? current;
};

/**
 * Heal legacy `chart-1`..`chart-10` colors stored on tiles by #2265
 * into their hue-named equivalents. Applied at fetch time so every
 * downstream consumer (renderers, the color picker, save mutations)
 * sees the canonical hue tokens that `ChartPaletteTokenSchema`
 * accepts, AND at write time so dashboards constructed outside the
 * fetch path (JSON imports via `DBDashboardImportPage`, presets, MCP
 * payloads) don't trip the strict server-side enum validator and
 * return a Zod 400. Symmetric application also lets the DB-side data
 * converge on next save instead of holding legacy tokens forever.
 *
 * Delegates the per-tile walk to `walkRawDashboardTileColors` in
 * common-utils so the unknown-import path and the API-side migration
 * shim stay in lockstep with this typed variant. The double cast is
 * unavoidable: the shared walker is generic over `unknown` so the
 * provisioner / API can call it, and TypeScript can't carry the
 * `tiles[]` element type through. The return shape is structurally
 * identical to the input.
 */
function normalizeDashboardTileColors<T extends { tiles?: Tile[] }>(
  dashboard: T,
): T {
  if (!dashboard.tiles || dashboard.tiles.length === 0) return dashboard;
  return walkRawDashboardTileColors(dashboard, migrateOrPreserveColor) as T;
}

/**
 * Walks a parsed-but-not-yet-validated JSON payload and rewrites every
 * `tiles[i].config.color` that points at a legacy `chart-1`..`chart-10`
 * value to its hue-named equivalent. Same policy as
 * `normalizeDashboardTileColors` (legacy → hue, unknown left intact for
 * the schema to flag) but exposed as `unknown -> unknown` so the
 * JSON-import flow in `DBDashboardImportPage` can heal legacy values
 * *before* the strict `DashboardTemplateSchema` parse (which would
 * otherwise reject the legacy enum and trip an error toast).
 */
export function normalizeRawDashboardTileColors(input: unknown): unknown {
  return walkRawDashboardTileColors(input, migrateOrPreserveColor);
}

/**
 * Shared queryFn behind `useDashboards`. Exported so tests can call it
 * directly (notably `dashboard.remote.test.ts`, which exercises the
 * non-local branch in isolation). React components should keep going
 * through `useDashboards` so React Query caching and invalidation
 * stays uniform.
 */
export async function fetchDashboards(): Promise<Dashboard[]> {
  if (IS_LOCAL_MODE) {
    return localDashboards.getAll().map(normalizeDashboardTileColors);
  }
  const dashboards = await hdxServer('dashboards').json<Dashboard[]>();
  return dashboards.map(normalizeDashboardTileColors);
}

export function useUpdateDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      dashboard: Partial<Dashboard> & { id: Dashboard['id'] },
    ) => {
      const normalized = normalizeDashboardTileColors(dashboard);
      if (IS_LOCAL_MODE) {
        const { id, ...updates } = normalized;
        localDashboards.update(id, updates);
        return;
      }
      await hdxServer(`dashboards/${normalized.id}`, {
        method: 'PATCH',
        json: normalized,
      });
    },
    onMutate: async (
      dashboard: Partial<Dashboard> & { id: Dashboard['id'] },
    ) => {
      await queryClient.cancelQueries({ queryKey: ['dashboards'] });
      const previousDashboards = queryClient.getQueryData<Dashboard[]>([
        'dashboards',
      ]);
      queryClient.setQueryData<Dashboard[]>(['dashboards'], current =>
        current
          ? current.map(d =>
              d.id === dashboard.id ? { ...d, ...dashboard } : d,
            )
          : current,
      );
      return { previousDashboards };
    },
    onError: (_error, _dashboard, context) => {
      if (context?.previousDashboards) {
        queryClient.setQueryData<Dashboard[]>(
          ['dashboards'],
          context.previousDashboards,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });
}

export function useCreateDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dashboard: Omit<Dashboard, 'id'>) => {
      const normalized = normalizeDashboardTileColors(dashboard);
      if (IS_LOCAL_MODE) {
        return localDashboards.create(normalized);
      }
      return hdxServer('dashboards', {
        method: 'POST',
        json: normalized,
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
      // URL-state local dashboards bypass `fetchDashboards`, so heal
      // any legacy `chart-N` here too (symmetric with the write-time
      // pass in `setDashboard` below).
      return localDashboard
        ? normalizeDashboardTileColors(localDashboard)
        : defaultDashboard;
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
        // Normalize on write too so the URL-state local dashboard never
        // holds a legacy `chart-N` after a no-fetch path (e.g. a tile
        // inserted via a preset literal) and matches the canonical hue
        // tokens used by the renderers.
        setLocalDashboard(normalizeDashboardTileColors(newDashboard));
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
  return localDashboards.getAll().map(normalizeDashboardTileColors);
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
