import { useCallback, useMemo, useState } from 'react';
import { HTTPError } from 'ky';
import { parseAsJson, useQueryState } from 'nuqs';
import {
  DashboardContainer,
  DashboardFilter,
  DashboardFilterValue,
  DashboardWithoutId,
  isPersistableUserId,
  OnboardingTaskId,
  resolveChartPaletteToken,
  SavedChartConfig,
  SearchConditionLanguage,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hashCode } from '@/utils';

import api, {
  hdxServer,
  useCompleteOnboardingTask,
  useInvalidateTags,
  useMarkOnboardingTaskComplete,
} from './api';
import { IS_LOCAL_MODE } from './config';
import { collectTags, createEntityStore } from './localStore';

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
  savedFilterValues?: DashboardFilterValue[];
  savedDateRange?: DashboardWithoutId['savedDateRange'];
  containers?: DashboardContainer[];
  createdAt?: string;
  updatedAt?: string;
  /**
   * The optimistic-concurrency token for dashboard writes. Optional because
   * IS_LOCAL_MODE dashboards live in URL state and have none. Opaque here
   * even though it is an integer on the wire — send it back to
   * `expectedVersion` verbatim.
   */
  version?: number;
  createdBy?: { email: string; name?: string };
  updatedBy?: { email: string; name?: string };
  /** Machine-managed by ProvisionDashboardsTask, whose name-keyed upsert
   *  overwrites tiles/tags/filters wholesale. Read-only here: the API already
   *  returns it, and the dashboards router strips any client-supplied value.
   *  Deliberately absent from `DashboardSchema`, which is the request
   *  contract. Unrelated to `Connection.platformProvisioned`. */
  provisioned?: boolean;
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

// Syncs the me cache after the backend records on save. 'dashboard' needs a
// tile, matching the backend (an empty shell isn't charting your data).
function markDashboardOnboarding(
  markOnboardingTaskComplete: (taskId: OnboardingTaskId) => void,
  tiles: Tile[] | undefined,
) {
  if (IS_LOCAL_MODE || !tiles?.length) {
    return;
  }
  markOnboardingTaskComplete('dashboard');
  if (tiles.some(tile => tile.config.alert != null)) {
    markOnboardingTaskComplete('alert');
  }
}

export function useUpdateDashboard(dashboardId?: string) {
  const queryClient = useQueryClient();
  const markOnboardingTaskComplete = useMarkOnboardingTaskComplete();
  const invalidateTags = useInvalidateTags();

  return useMutation({
    // TanStack runs same-scope mutations one at a time, so two saves fired
    // back to back queue instead of racing (HDX-4159). That buys ordering
    // and a deterministic loser: whichever save is queued second still
    // carries the version its payload was built from, so it 409s against
    // the first save's write rather than silently overwriting it.
    scope: dashboardId ? { id: `dashboard-${dashboardId}` } : undefined,
    mutationFn: async (
      dashboard: Partial<Dashboard> & { id: Dashboard['id'] },
    ) => {
      // `updatedAt` is a display-only field the API returns but doesn't
      // accept back; drop it here too so it isn't echoed into the PATCH body.
      const { version, updatedAt: _updatedAt, ...rest } = dashboard;
      const normalized = normalizeDashboardTileColors(rest);
      if (IS_LOCAL_MODE) {
        const { id, ...updates } = normalized;
        localDashboards.update(id, updates);
        return undefined;
      }
      // Send the version the payload itself was built from, not whatever
      // is newest in the cache. Re-reading the cache here would let a save
      // whose payload predates a sibling's write pass the guard with the
      // sibling's fresher token, silently reverting the sibling's change
      // with the stale document this save still carries.
      // Return the persisted dashboard so onboarding keys off saved tiles, not
      // the partial PATCH payload — a name/tag-only save omits `tiles`.
      return hdxServer(`dashboards/${normalized.id}`, {
        method: 'PATCH',
        json: {
          ...normalized,
          expectedVersion: version != null ? String(version) : undefined,
        },
      }).json<Dashboard>();
    },
    onSuccess: updated => {
      // Seed the new token synchronously. invalidateQueries alone refetches
      // asynchronously, leaving a window where the next save would send a
      // stale token and 409 against its own predecessor.
      if (updated != null) {
        queryClient.setQueryData<Dashboard[]>(['dashboards'], prev =>
          prev?.map(d =>
            d.id === updated.id
              ? {
                  ...d,
                  ...updated,
                  // The PATCH response comes straight from findOneAndUpdate
                  // with no populate, so these arrive as bare ObjectIds and
                  // would blank the author names the list query resolved,
                  // until the refetch below lands.
                  createdBy: d.createdBy,
                  updatedBy: d.updatedBy,
                }
              : d,
          ),
        );
      }
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      invalidateTags();
      markDashboardOnboarding(markOnboardingTaskComplete, updated?.tiles);
    },
  });
}

export function useCreateDashboard() {
  const queryClient = useQueryClient();
  const markOnboardingTaskComplete = useMarkOnboardingTaskComplete();
  const invalidateTags = useInvalidateTags();

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
    onSuccess: created => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      invalidateTags();
      // Key off the server's persisted tiles (see useUpdateDashboard).
      markDashboardOnboarding(markOnboardingTaskComplete, created?.tiles);
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

  const queryClient = useQueryClient();
  const updateDashboard = useUpdateDashboard(dashboardId);
  const completeOnboardingTask = useCompleteOnboardingTask();
  const { data: me } = api.useMe();
  // A non-persistable user counts as "already built" so the temp-dashboard POST
  // never fires (see isPersistableUserId).
  const hasBuiltDashboard =
    !isPersistableUserId(me?.id) ||
    (me?.onboardingData?.completedTasks.includes('dashboard') ?? false);

  const { data: remoteDashboard, isFetching: isFetchingRemoteDashboard } =
    useQuery({
      queryKey: ['dashboards'],
      queryFn: fetchDashboards,
      select: (data: Dashboard[]) => {
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
        // Temp dashboards never hit the backend, so record here. Guarded on
        // hasBuiltDashboard because setDashboard runs on every layout edit.
        if (
          !IS_LOCAL_MODE &&
          !hasBuiltDashboard &&
          (newDashboard.tiles?.length ?? 0) > 0
        ) {
          completeOnboardingTask.mutate('dashboard');
        }
        onSuccess?.();
      } else {
        setIsSettingDashboard(true);
        // `remoteDashboard` is the render this payload was built from, so
        // its version describes what the payload assumes is still current —
        // that's the token the write needs to check against.
        return updateDashboard.mutate(
          { ...newDashboard, version: remoteDashboard?.version },
          {
            onSuccess: () => {
              setIsSettingDashboard(false);
              onSuccess?.();
            },
            onError: async e => {
              setIsSettingDashboard(false);
              if (e instanceof HTTPError && e.response?.status === 409) {
                await queryClient.invalidateQueries({
                  queryKey: ['dashboards'],
                });
                notifications.show({
                  color: 'yellow',
                  // Describes the state rather than blaming another person:
                  // a rejected save is just as often the user's own second
                  // edit made against a render the first save superseded.
                  title: 'Dashboard has newer changes',
                  message:
                    'Your change was not saved. The latest version has been loaded — please reapply it.',
                  autoClose: 8000,
                });
              } else {
                notifications.show({
                  color: 'red',
                  title: 'Unable to save dashboard',
                  message: e.message.slice(0, 100),
                  autoClose: 5000,
                });
              }
              onError?.();
            },
          },
        );
      }
    },
    [
      isLocalDashboard,
      setLocalDashboard,
      updateDashboard,
      remoteDashboard,
      queryClient,
      completeOnboardingTask,
      hasBuiltDashboard,
    ],
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
  return collectTags(localDashboards.getAll());
}

export function useDeleteDashboard() {
  const queryClient = useQueryClient();
  const invalidateTags = useInvalidateTags();

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
      invalidateTags();
    },
  });
}
