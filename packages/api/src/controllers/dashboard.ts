import { differenceBy, uniq } from 'lodash';
import { z } from 'zod';

import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { DashboardSchema, DashboardWithoutIdSchema } from '@/utils/commonTypes';
import { chartSchema, tagsSchema } from '@/utils/zod';

export async function getDashboards(teamId: ObjectId) {
  const dashboards = await Dashboard.find({
    team: teamId,
  });
  return dashboards;
}

export async function getDashboard(dashboardId: string, teamId: ObjectId) {
  return Dashboard.findOne({
    _id: dashboardId,
    team: teamId,
  });
}

export async function createDashboard(
  teamId: ObjectId,
  dashboard: z.infer<typeof DashboardWithoutIdSchema>,
) {
  const newDashboard = await new Dashboard({
    ...dashboard,
    team: teamId,
  }).save();
  return newDashboard;
}

export async function deleteDashboardAndAlerts(
  dashboardId: string,
  teamId: ObjectId,
) {
  const dashboard = await Dashboard.findOneAndDelete({
    _id: dashboardId,
    team: teamId,
  });
  if (dashboard) {
    await Alert.deleteMany({ dashboardId: dashboard._id });
  }
}

export async function updateDashboard(
  dashboardId: string,
  teamId: ObjectId,
  {
    name,
    charts,
    query,
    tags,
  }: {
    name: string;
    charts: z.infer<typeof chartSchema>[];
    query: string;
    tags: z.infer<typeof tagsSchema>;
  },
) {
  const updatedDashboard = await Dashboard.findOneAndUpdate(
    {
      _id: dashboardId,
      team: teamId,
    },
    {
      name,
      charts,
      query,
      tags: tags && uniq(tags),
    },
    { new: true },
  );

  return updatedDashboard;
}

export async function updateDashboardAndAlerts(
  dashboardId: string,
  teamId: ObjectId,
  dashboard: z.infer<typeof DashboardWithoutIdSchema>,
) {
  const oldDashboard = await Dashboard.findOne({
    _id: dashboardId,
    team: teamId,
  });
  if (oldDashboard == null) {
    throw new Error('Dashboard not found');
  }

  const updatedDashboard = await Dashboard.findOneAndUpdate(
    {
      _id: dashboardId,
      team: teamId,
    },
    {
      ...dashboard,
      tags: dashboard.tags && uniq(dashboard.tags),
    },
    { new: true },
  );
  if (updatedDashboard == null) {
    throw new Error('Could not update dashboard');
  }

  // Delete related alerts
  const deletedChartIds = differenceBy(
    oldDashboard?.tiles || [],
    updatedDashboard?.tiles || [],
    'id',
  ).map(c => c.id);

  if (deletedChartIds?.length > 0) {
    await Alert.deleteMany({
      dashboardId: dashboardId,
      chartId: { $in: deletedChartIds },
    });
  }

  return updatedDashboard;
}
