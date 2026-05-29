import { useCallback, useMemo, useState } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import {
  DashboardContainer,
  DashboardFilter,
  Filter,
  resolveChartPaletteToken,
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
 * Hue tokens already match the resolver and pass through unchanged.
 * Strings that aren't resolvable to a current `ChartPaletteToken`
 * (stale hexes, hand-edited values, future tokens from a forward-rolled
 * deploy) are stripped from `config.color` rather than passed through —
 * leaving them in place would trip the strict server-side
 * `ChartPaletteTokenSchema` on the next save and 400 the request. The
 * returned tile array preserves identity where nothing changed so React
 * reconciliation stays cheap, and the helper is safe to call on payloads
 * that omit `tiles` entirely (partial PATCHes).
 */
function normalizeDashboardTileColors<T extends { tiles?: Tile[] }>(
  dashboard: T,
): T {
  if (!dashboard.tiles || dashboard.tiles.length === 0) return dashboard;
  let changed = false;
  const tiles = dashboard.tiles.map(tile => {
    const current = tile.config?.color;
    if (typeof current !== 'string') return tile;
    const resolved = resolveChartPaletteToken(current);
    if (resolved === current) return tile;
    changed = true;
    if (resolved === undefined) {
      const { color: _drop, ...rest } = tile.config;
      return { ...tile, config: rest as Tile['config'] };
    }
    return {
      ...tile,
      config: { ...tile.config, color: resolved } as Tile['config'],
    };
  });
  return changed ? { ...dashboard, tiles } : dashboard;
}

/**
 * Walks a parsed-but-not-yet-validated JSON payload and rewrites every
 * `tiles[i].config.color` that points at a legacy `chart-1`..`chart-10`
 * value to its hue-named equivalent. Mirrors `normalizeDashboardTileColors`
 * but operates on `unknown` data so the JSON-import flow in
 * `DBDashboardImportPage` can heal legacy values *before* the strict
 * `DashboardTemplateSchema` parse (which would reject the legacy enum and
 * trip an error toast).
 *
 * Unlike `normalizeDashboardTileColors`, this raw variant leaves unknown
 * non-token strings in place so the schema's own validation message
 * surfaces them to the user with the proper "Invalid enum value" copy —
 * stripping the field here would silently swallow a typo in an
 * imported file.
 */
export function normalizeRawDashboardTileColors(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const root = input as { tiles?: unknown };
  const tiles = root.tiles;
  if (!Array.isArray(tiles)) return input;
  let changed = false;
  const nextTiles = tiles.map(tile => {
    if (!tile || typeof tile !== 'object') return tile;
    const t = tile as { config?: unknown };
    const config = t.config;
    if (!config || typeof config !== 'object') return tile;
    const c = config as { color?: unknown };
    const current = c.color;
    if (typeof current !== 'string') return tile;
    const resolved = resolveChartPaletteToken(current);
    if (resolved === undefined || resolved === current) return tile;
    changed = true;
    return { ...t, config: { ...c, color: resolved } };
  });
  return changed ? { ...root, tiles: nextTiles } : input;
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
    onSuccess: () => {
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
