import { validateDashboardFilterOptionUniqueness } from '@hyperdx/common-utils/dist/dashboardValidation';
import {
  DashboardWithoutId,
  DashboardWithoutIdSchema,
  resolveChartPaletteToken,
  Tile,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import fs from 'fs';
import { Types } from 'mongoose';
import path from 'path';

import {
  AlertInput,
  createOrUpdateDashboardAlerts,
  validateAlertInput,
} from '@/controllers/alerts';
import { connectDB, mongooseConnection } from '@/models';
import Alert, { AlertSource } from '@/models/alert';
import Dashboard, { IDashboard } from '@/models/dashboard';
import Team from '@/models/team';
import type { HdxTask } from '@/tasks/types';
import { ProvisionDashboardsTaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

// Heal legacy `chart-1`..`chart-10` tile colors from #2265 before the
// strict `DashboardWithoutIdSchema` parse rejects them. Same policy as
// the React `normalizeDashboardTileColors` and the API router's
// `migrateLegacyDashboardTileColors`: hue tokens pass through, legacy
// numeric tokens are rewritten to hue-named equivalents, and unknown
// strings are left intact so the schema's native enum error surfaces
// in the warn log instead of silently dropping the field.
function migrateLegacyDashboardTileColorsRaw(raw: unknown): unknown {
  return walkRawDashboardTileColors(raw, current => {
    const resolved = resolveChartPaletteToken(current);
    return resolved ?? current;
  });
}

const provisionedDashboardSchema = DashboardWithoutIdSchema.superRefine(
  (data, ctx) =>
    validateDashboardFilterOptionUniqueness(data.filters ?? [], ctx),
);

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
      const raw = migrateLegacyDashboardTileColorsRaw(
        JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')),
      ) as Record<string, unknown> | null | undefined;
      const parsed = provisionedDashboardSchema.safeParse({
        tags: [],
        ...(raw as object),
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

// Turns the `config.alert` of each provisioned tile into a tile alert, the way
// saving a dashboard through the API does. An alert that fails validation is
// skipped and keeps its last valid version; a provisioned alert whose tile no
// longer declares one is removed. Alerts created in the app are left alone.
export async function syncProvisionedAlerts(
  dashboard: Pick<IDashboard, '_id' | 'name' | 'tags' | 'tiles'>,
  teamId: string,
  tiles: Tile[],
) {
  const team = new Types.ObjectId(teamId);
  const declared = tiles.filter(tile => tile.config.alert != null);

  const alertsByTile: Record<string, AlertInput> = {};
  for (const tile of declared) {
    const alert = tile.config.alert as AlertInput;
    try {
      await validateAlertInput(team, {
        source: AlertSource.TILE,
        dashboardId: dashboard._id.toString(),
        tileId: tile.id,
        channel: alert.channel,
        channels: alert.channels,
      });
      alertsByTile[tile.id] = alert;
    } catch (err) {
      logger.warn(
        {
          name: dashboard.name,
          tileId: tile.id,
          err: err instanceof Error ? err.message : err,
        },
        'Skipping invalid provisioned tile alert',
      );
    }
  }

  if (Object.keys(alertsByTile).length > 0) {
    await createOrUpdateDashboardAlerts(
      dashboard,
      team,
      alertsByTile,
      undefined,
      { provisioned: true },
    );
  }

  await Alert.deleteMany({
    dashboard: dashboard._id,
    team,
    source: AlertSource.TILE,
    provisioned: true,
    tileId: { $nin: declared.map(tile => tile.id) },
  });
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

      const saved = await Dashboard.findOne({
        name: dashboard.name,
        team: teamId,
        provisioned: true,
      });
      if (saved) {
        await syncProvisionedAlerts(saved, teamId, dashboard.tiles || []);
      }
    } catch (err) {
      logger.error(
        { err, name: dashboard.name },
        'Failed to provision dashboard',
      );
    }
  }
}

export default class ProvisionDashboardsTask implements HdxTask {
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
