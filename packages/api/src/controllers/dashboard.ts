import { DashboardWithoutIdSchema } from '@berg/common-utils/dist/types';
import { uniq } from 'lodash';
import { z } from 'zod';

import type { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';

export async function getDashboards(teamId: ObjectId) {
  const dashboards = await Dashboard.find({ team: teamId })
    .populate('createdBy', 'email name')
    .populate('updatedBy', 'email name');

  return dashboards.map(d => d.toJSON());
}

export async function getDashboard(dashboardId: string, teamId: ObjectId) {
  const dashboard = await Dashboard.findOne({ _id: dashboardId, team: teamId })
    .populate('createdBy', 'email name')
    .populate('updatedBy', 'email name');

  return dashboard?.toJSON();
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

  return newDashboard;
}

export async function deleteDashboard(dashboardId: string, teamId: ObjectId) {
  await Dashboard.findOneAndDelete({
    _id: dashboardId,
    team: teamId,
  });
}

export async function updateDashboard(
  dashboardId: string,
  teamId: ObjectId,
  updates: Partial<z.infer<typeof DashboardWithoutIdSchema>>,
  userId?: ObjectId,
) {
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

  return updatedDashboard;
}
