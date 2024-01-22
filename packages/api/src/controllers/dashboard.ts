import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Dashboard from '@/models/dashboard';

export default async function deleteDashboardAndAlerts(
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
