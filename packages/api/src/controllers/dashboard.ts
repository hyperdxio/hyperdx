import {
  AlertSource,
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
import Dashboard from '@/models/dashboard';

function pickAlertsByTile(tiles: Tile[]) {
  return tiles.reduce((acc, tile) => {
    if (tile.config.alert) {
      acc[tile.id] = tile.config.alert;
    }
    return acc;
  }, {});
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
    // Handle alert creation/updates
    const alertsByTile = pickAlertsByTile(updates.tiles);
    if (Object.keys(alertsByTile).length > 0) {
      await createOrUpdateDashboardAlerts(
        dashboardId,
        teamId,
        alertsByTile,
        userId,
      );
    }

    // Clean up alerts for deleted tiles
    const currentTileIds = new Set(updates.tiles.map(t => t.id));
    const deletedTileIds = (oldDashboard.tiles || [])
      .map(t => t.id)
      .filter(id => !currentTileIds.has(id));

    if (deletedTileIds.length > 0) {
      await deleteDashboardAlerts(dashboardId, teamId, deletedTileIds);
    }
  }

  return updatedDashboard;
}
