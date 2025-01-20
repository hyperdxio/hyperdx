import { DashboardWithoutIdSchema } from '@hyperdx/common-utils/dist/types';
import { groupBy, uniq } from 'lodash';
import { z } from 'zod';

import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Dashboard from '@/models/dashboard';

export async function getDashboards(teamId: ObjectId) {
  const _dashboards = await Dashboard.find({
    team: teamId,
  });

  const alertsByTileId = groupBy(
    await Alert.find({
      dashboard: { $in: _dashboards.map(d => d._id) },
      source: 'tile',
      team: teamId,
    }),
    'tileId',
  );

  const dashboards = _dashboards
    .map(d => d.toJSON())
    .map(d => ({
      ...d,
      tiles: d.tiles.map(t => ({
        ...t,
        config: { ...t.config, alert: alertsByTileId[t.id]?.[0] },
      })),
    }));

  return dashboards;
}

export async function getDashboard(dashboardId: string, teamId: ObjectId) {
  const _dashboard = await Dashboard.findOne({
    _id: dashboardId,
    team: teamId,
  });

  const alertsByTileId = groupBy(
    await Alert.find({
      dashboard: dashboardId,
      source: 'tile',
      team: teamId,
    }),
    'tileId',
  );

  return {
    ..._dashboard,
    tiles: _dashboard?.tiles.map(t => ({
      ...t,
      config: { ...t.config, alert: alertsByTileId[t.id]?.[0] },
    })),
  };
}

export async function createDashboard(
  teamId: ObjectId,
  dashboard: z.infer<typeof DashboardWithoutIdSchema>,
) {
  const newDashboard = await new Dashboard({
    ...dashboard,
    team: teamId,
  }).save();

  // Create related alerts
  for (const tile of dashboard.tiles) {
    if (tile.config.alert) {
      await Alert.findOneAndUpdate(
        {
          dashboard: newDashboard._id,
          tileId: tile.id,
          source: 'tile',
          team: teamId,
        },
        { ...tile.config.alert },
        { new: true, upsert: true },
      );
    }
  }

  return newDashboard;
}

export async function deleteDashboard(dashboardId: string, teamId: ObjectId) {
  const dashboard = await Dashboard.findOneAndDelete({
    _id: dashboardId,
    team: teamId,
  });
  if (dashboard) {
    await Alert.deleteMany({ dashboard: dashboard._id, team: teamId });
  }
}

export async function updateDashboard(
  dashboardId: string,
  teamId: ObjectId,
  updates: Partial<z.infer<typeof DashboardWithoutIdSchema>>,
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

  // Update related alerts
  // - Delete
  const newAlertIds = updates.tiles?.map(t => t.config.alert?.id);
  const deletedAlertIds: string[] = [];

  if (oldDashboard.tiles) {
    for (const tile of oldDashboard.tiles) {
      if (
        tile.config.alert?._id &&
        !newAlertIds?.includes(tile.config.alert?._id.toString())
      ) {
        deletedAlertIds.push(tile.config.alert._id.toString());
      }
    }

    if (deletedAlertIds?.length > 0) {
      await Alert.deleteMany({
        dashboard: dashboardId,
        team: teamId,
        _id: { $in: deletedAlertIds },
      });
    }
  }

  // - Update / Create
  if (updates.tiles) {
    for (const tile of updates.tiles) {
      if (tile.config.alert) {
        await Alert.findOneAndUpdate(
          {
            dashboard: dashboardId,
            tileId: tile.id,
            source: 'tile',
            team: teamId,
          },
          { ...tile.config.alert },
          { new: true, upsert: true },
        );
      }
    }
  }

  return updatedDashboard;
}
