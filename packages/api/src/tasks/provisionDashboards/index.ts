import {
  DashboardWithoutId,
  DashboardWithoutIdSchema,
} from '@hyperdx/common-utils/dist/types';
import fs from 'fs';
import path from 'path';

import { connectDB, mongooseConnection } from '@/models';
import Dashboard from '@/models/dashboard';
import Team from '@/models/team';
import type { HdxTask } from '@/tasks/types';
import { ProvisionDashboardsTaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

export function readDashboardFiles(dir: string): DashboardWithoutId[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (err) {
    logger.error({ err, dir }, 'Failed to read dashboard directory');
    return [];
  }

  const dashboards: DashboardWithoutId[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const parsed = DashboardWithoutIdSchema.safeParse({
        tags: [],
        ...raw,
      });
      if (!parsed.success) {
        logger.warn(
          { file, errors: parsed.error.issues },
          'Skipping invalid dashboard file',
        );
        continue;
      }
      dashboards.push(parsed.data);
    } catch (err) {
      logger.error({ err, file }, 'Failed to parse dashboard file');
    }
  }
  return dashboards;
}

export async function syncDashboards(teamId: string, dir: string) {
  const dashboards = readDashboardFiles(dir);
  if (dashboards.length === 0) return;

  for (const dashboard of dashboards) {
    try {
      const userDashboard = await Dashboard.exists({
        name: dashboard.name,
        team: teamId,
        provisioned: { $ne: true },
      });
      if (userDashboard) {
        logger.warn(
          { name: dashboard.name },
          'A user-created dashboard with this name already exists, provisioned copy will coexist',
        );
      }

      const result = await Dashboard.findOneAndUpdate(
        { name: dashboard.name, team: teamId, provisioned: true },
        {
          $set: {
            tiles: dashboard.tiles || [],
            tags: dashboard.tags || [],
            filters: dashboard.filters || [],
            savedQuery: dashboard.savedQuery ?? null,
            savedQueryLanguage: dashboard.savedQueryLanguage ?? null,
            savedFilterValues: dashboard.savedFilterValues || [],
            containers: dashboard.containers || [],
          },
          $setOnInsert: {
            name: dashboard.name,
            team: teamId,
            provisioned: true,
          },
        },
        { upsert: true, new: false },
      );

      if (result === null) {
        logger.info({ name: dashboard.name }, 'Created provisioned dashboard');
      }
    } catch (err) {
      logger.error(
        { err, name: dashboard.name },
        'Failed to provision dashboard',
      );
    }
  }
}

export default class ProvisionDashboardsTask
  implements HdxTask<ProvisionDashboardsTaskArgs>
{
  constructor(private args: ProvisionDashboardsTaskArgs) {}

  name(): string {
    return this.args.taskName;
  }

  async execute(): Promise<void> {
    await connectDB();

    const dir = process.env.DASHBOARD_PROVISIONER_DIR;
    if (!dir) {
      throw new Error(
        'DASHBOARD_PROVISIONER_DIR environment variable is required',
      );
    }

    const teamId = process.env.DASHBOARD_PROVISIONER_TEAM_ID;
    const provisionAllTeams =
      process.env.DASHBOARD_PROVISIONER_ALL_TEAMS === 'true';

    if (teamId && provisionAllTeams) {
      logger.warn(
        'Both DASHBOARD_PROVISIONER_TEAM_ID and DASHBOARD_PROVISIONER_ALL_TEAMS are set, using TEAM_ID',
      );
    }

    if (!teamId && !provisionAllTeams) {
      throw new Error(
        'DASHBOARD_PROVISIONER_TEAM_ID is required (or set DASHBOARD_PROVISIONER_ALL_TEAMS=true)',
      );
    }

    if (teamId && !/^[0-9a-fA-F]{24}$/.test(teamId)) {
      throw new Error(
        `DASHBOARD_PROVISIONER_TEAM_ID is not a valid ObjectId: ${teamId}`,
      );
    }

    if (!fs.existsSync(dir)) {
      logger.warn({ dir }, 'Dashboard provisioner directory does not exist');
      return;
    }

    let teamIds: string[];
    if (teamId) {
      const teamExists = await Team.exists({ _id: teamId });
      if (!teamExists) {
        logger.warn(
          { teamId },
          'Configured team does not exist, skipping sync',
        );
        return;
      }
      teamIds = [teamId];
    } else {
      const teams = await Team.find().select('_id').lean();
      teamIds = teams.map(t => t._id.toString());
    }

    for (const id of teamIds) {
      await syncDashboards(id, dir);
    }
  }

  async asyncDispose(): Promise<void> {
    await mongooseConnection.close();
  }
}
