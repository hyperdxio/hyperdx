import {
  DashboardWithoutIdSchema,
  Tile,
} from '@hyperdx/common-utils/dist/types';
import { uniq } from 'lodash';
import { z } from 'zod';

import {
  createOrUpdateDashboardAlerts,
  deleteDashboardAlerts,
  getDashboardAlertsByTile,
  getTeamDashboardAlertsByTile,
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

type TileForAlertSync = Pick<Tile, 'id'> & {
  config?: Pick<Tile['config'], 'alert'> | { alert?: IAlert | AlertDocument };
};

function extractTileAlertData(tiles: TileForAlertSync[]): {
  tileIds: Set<string>;
  tileIdsWithAlerts: Set<string>;
} {
  const tileIds = new Set<string>();
  const tileIdsWithAlerts = new Set<string>();

  tiles.forEach(tile => {
    tileIds.add(tile.id);
    if (tile.config?.alert) {
      tileIdsWithAlerts.add(tile.id);
    }
  });

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
  const { tileIds: newTileIds, tileIdsWithAlerts: newTileIdsWithAlerts } =
    extractTileAlertData(newTiles);

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
    Dashboard.find({ team: teamId }),
    getTeamDashboardAlertsByTile(teamId),
  ]);

  const dashboards = _dashboards
    .map(d => d.toJSON())
    .map(d => ({
      ...d,
      tiles: d.tiles.map(t => ({
        ...t,
        config: { ...t.config, alert: alerts[t.id]?.[0] },
      })),
    }));

  return dashboards;
}

export async function getDashboard(dashboardId: string, teamId: ObjectId) {
  const [_dashboard, alerts] = await Promise.all([
    Dashboard.findOne({ _id: dashboardId, team: teamId }),
    getDashboardAlertsByTile(teamId, dashboardId),
  ]);

  return {
    ..._dashboard,
    tiles: _dashboard?.tiles.map(t => ({
      ...t,
      config: { ...t.config, alert: alerts[t.id]?.[0] },
    })),
  };
}

export async function createDashboard(
  teamId: ObjectId,
  dashboard: z.infer<typeof DashboardWithoutIdSchema>,
  userId?: ObjectId,
) {
  const newDashboard = await new Dashboard({
    ...dashboard,
    team: teamId,
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
      oldDashboard.tiles || [],
      updates.tiles,
      userId,
    );
  }

  return updatedDashboard;
}
