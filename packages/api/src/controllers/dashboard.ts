import { differenceBy, uniq } from 'lodash';
import { z } from 'zod';

import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { chartSchema, tagsSchema } from '@/utils/zod';

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

export async function updateDashboardAndAlerts(
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
      name,
      charts,
      query,
      tags: tags && uniq(tags),
    },
    { new: true },
  );
  if (updatedDashboard == null) {
    throw new Error('Could not update dashboard');
  }

  // Delete related alerts
  const deletedChartIds = differenceBy(
    oldDashboard?.charts || [],
    updatedDashboard?.charts || [],
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
