import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Dashboard, { IDashboard } from '@/models/dashboard';

export type DashboardInput = Omit<IDashboard, '_id'>;

const makeDashboard = (
  dashboard: DashboardInput,
  team: ObjectId,
): DashboardInput => {
  return {
    name: dashboard.name,
    query: dashboard.query,
    charts: dashboard.charts,
    team: team,
  };
};

export const createDashboard = async (
  teamId: ObjectId,
  dashboard: DashboardInput,
) => {
  return new Dashboard({
    ...makeDashboard(dashboard, teamId),
    team: teamId,
  }).save();
};

export const updateDashboard = async (
  id: string,
  teamId: ObjectId,
  dashboardInput: DashboardInput,
) => {
  const dashboard = await Dashboard.findOne({ _id: id, team: teamId });
  await dashboard?.updateOne(makeDashboard(dashboardInput, teamId));
  return Dashboard.findOne({ _id: id, team: teamId });
};

export const getDashboard = async (id: string, teamId: ObjectId) => {
  return Dashboard.findOne({ _id: id, team: teamId });
};

export const getAllDashboards = async (teamId: ObjectId) => {
  return Dashboard.find({ team: teamId });
};

export const deleteDashboard = async (id: string, teamId: ObjectId) => {
  const dashboard = await Dashboard.findOne({ _id: id, team: teamId });
  if (dashboard === null) {
    return null;
  }
  await Alert.deleteMany({ dashboardId: id });
  // TODO check result of removal operation
  await dashboard.remove();
  return dashboard;
};
