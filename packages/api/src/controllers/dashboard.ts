import {
  DashboardWithoutIdSchema,
  resolveChartPaletteToken,
  SavedChartConfig,
  Tile,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import { map, partition, uniq } from 'lodash';
import { z } from 'zod';

import {
  createOrUpdateDashboardAlerts,
  deleteDashboardAlerts,
  getDashboardAlertsByTile,
  getTeamDashboardAlertsByDashboardAndTile,
} from '@/controllers/alerts';
import type { ObjectId } from '@/models';
import type { AlertDocument, IAlert } from '@/models/alert';
import Dashboard from '@/models/dashboard';

function pickAlertsByTile(tiles: Tile[]) {
  return tiles.reduce((acc, tile) => {
    if (tile.config.alert) {
      acc[tile.id] = tile.config.alert;
    }
    return acc;
  }, {});
}

/**
 * Rewrite any legacy `chart-1`..`chart-10` tile colors from #2265 in
 * an already-serialized dashboard JSON to their hue-named equivalents
 * before it leaves the server. Keeps the wire format on a single
 * canonical vocabulary so non-React HTTP clients (CI scripts, stale
 * bundle tabs during a rolling deploy, the upcoming external API
 * surface) never have to know about the legacy values, and so a
 * GET → unmodified PATCH round-trip on a Mongo-seeded legacy doc can
 * never resurrect the legacy tokens through the strict server-side
 * `ChartPaletteTokenSchema`. The React-side
 * `normalizeDashboardTileColors` becomes redundant for the wire path
 * after this lands but stays in place as defense in depth for
 * `IS_LOCAL_MODE` and in-memory tile literals.
 *
 * Unresolvable strings (stale hexes, hand-edited values, forward-rolled
 * future tokens) pass through untouched so the user's data is not
 * silently dropped; the strict schema surfaces a clear error on next
 * save.
 */
function healLegacyDashboardTileColors<T>(dashboard: T): T {
  return walkRawDashboardTileColors(dashboard, current => {
    const resolved = resolveChartPaletteToken(current);
    return resolved ?? current;
  }) as T;
}

type TileForAlertSync = Pick<Tile, 'id'> & {
  config?: Pick<SavedChartConfig, 'alert'> | { alert?: IAlert | AlertDocument };
};

function extractTileAlertData(tiles: TileForAlertSync[]): {
  tileIds: Set<string>;
  tileIdsWithAlerts: Set<string>;
} {
  const [tilesWithAlerts, _] = partition(tiles, 'config.alert');
  const tileIds = new Set(map(tiles, 'id'));
  const tileIdsWithAlerts = new Set(map(tilesWithAlerts, 'id'));

  return { tileIds, tileIdsWithAlerts };
}

async function syncDashboardAlerts(
  dashboardId: string,
  teamId: ObjectId,
  oldTiles: TileForAlertSync[],
  newTiles: Tile[],
  userId?: ObjectId,
): Promise<void> {
  const { tileIds: oldTileIds, tileIdsWithAlerts: oldTileIdsWithAlerts } =
    extractTileAlertData(oldTiles);

  const newTilesForAlertSync: TileForAlertSync[] = newTiles.map(t => ({
    id: t.id,
    config: { alert: t.config.alert },
  }));
  const { tileIds: newTileIds, tileIdsWithAlerts: newTileIdsWithAlerts } =
    extractTileAlertData(newTilesForAlertSync);

  // 1. Create/update alerts for tiles that have alerts
  const alertsByTile = pickAlertsByTile(newTiles);
  if (Object.keys(alertsByTile).length > 0) {
    await createOrUpdateDashboardAlerts(
      dashboardId,
      teamId,
      alertsByTile,
      userId,
    );
  }

  // 2. Identify tiles whose alerts need to be deleted
  const tilesToDeleteAlertsFrom = new Set([
    // Tiles that were completely removed
    ...Array.from(oldTileIds).filter(id => !newTileIds.has(id)),
    // Tiles that exist but no longer have alerts
    ...Array.from(oldTileIdsWithAlerts).filter(
      id => newTileIds.has(id) && !newTileIdsWithAlerts.has(id),
    ),
  ]);

  // 3. Delete alerts
  if (tilesToDeleteAlertsFrom.size > 0) {
    await deleteDashboardAlerts(
      dashboardId,
      teamId,
      Array.from(tilesToDeleteAlertsFrom),
    );
  }
}

export async function getDashboards(teamId: ObjectId) {
  const [_dashboards, alerts] = await Promise.all([
    Dashboard.find({ team: teamId })
      .populate('createdBy', 'email name')
      .populate('updatedBy', 'email name'),
    getTeamDashboardAlertsByDashboardAndTile(teamId),
  ]);

  const dashboards = _dashboards
    .map(d => d.toJSON())
    .map(d => ({
      ...d,
      tiles: d.tiles.map(t => ({
        ...t,
        config: {
          ...t.config,
          alert: alerts[`${d._id.toString()}:${t.id}`]?.[0],
        },
      })),
    }))
    .map(healLegacyDashboardTileColors);

  return dashboards;
}

export async function getDashboard(dashboardId: string, teamId: ObjectId) {
  const [_dashboard, alerts] = await Promise.all([
    Dashboard.findOne({ _id: dashboardId, team: teamId })
      .populate('createdBy', 'email name')
      .populate('updatedBy', 'email name'),
    getDashboardAlertsByTile(teamId, dashboardId),
  ]);

  return healLegacyDashboardTileColors({
    ..._dashboard?.toJSON(),
    tiles: _dashboard?.tiles.map(t => ({
      ...t,
      config: { ...t.config, alert: alerts[t.id]?.[0] },
    })),
  });
}

export async function createDashboard(
  teamId: ObjectId,
  dashboard: z.infer<typeof DashboardWithoutIdSchema>,
  userId?: ObjectId,
) {
  const newDashboard = await new Dashboard({
    ...dashboard,
    team: teamId,
    createdBy: userId,
    updatedBy: userId,
  }).save();

  await createOrUpdateDashboardAlerts(
    newDashboard._id,
    teamId,
    pickAlertsByTile(dashboard.tiles),
    userId,
  );

  return newDashboard;
}

export async function deleteDashboard(dashboardId: string, teamId: ObjectId) {
  const dashboard = await Dashboard.findOneAndDelete({
    _id: dashboardId,
    team: teamId,
  });
  if (dashboard) {
    await deleteDashboardAlerts(dashboardId, teamId);
  }
}

export async function updateDashboard(
  dashboardId: string,
  teamId: ObjectId,
  updates: Partial<z.infer<typeof DashboardWithoutIdSchema>>,
  userId?: ObjectId,
) {
  const oldDashboard = await getDashboard(dashboardId, teamId);

  if (oldDashboard == null) {
    throw new Error('Dashboard not found');
  }

  const updatedDashboard = await Dashboard.findOneAndUpdate(
    {
      _id: dashboardId,
      team: teamId,
    },
    {
      ...updates,
      tags: updates.tags && uniq(updates.tags),
      updatedBy: userId,
    },
    { new: true },
  );
  if (updatedDashboard == null) {
    throw new Error('Could not update dashboard');
  }

  if (updates.tiles) {
    await syncDashboardAlerts(
      dashboardId,
      teamId,
      oldDashboard?.tiles || [],
      updates.tiles,
      userId,
    );
  }

  return updatedDashboard;
}
