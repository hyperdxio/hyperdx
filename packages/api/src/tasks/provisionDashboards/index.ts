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
import Webhook from '@/models/webhook';
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

// A file names a webhook with `{ "type": "webhook", "webhookName": "..." }`,
// since webhook ids differ per team and per install. Names only resolve per
// team, after the file is parsed, so until then the name rides in `webhookId`
// behind this prefix. It never reaches Mongo: resolveWebhookNames swaps it for
// the real id, or drops the alert from the stored tile.
const WEBHOOK_NAME_REF = 'webhook-name:';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

function encodeWebhookName(channel: unknown): unknown {
  if (
    !isRecord(channel) ||
    typeof channel.webhookName !== 'string' ||
    'webhookId' in channel
  ) {
    return channel;
  }
  const { webhookName, ...rest } = channel;
  return { ...rest, webhookId: `${WEBHOOK_NAME_REF}${webhookName}` };
}

function encodeWebhookNames(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.tiles)) return raw;
  for (const tile of raw.tiles) {
    const alert =
      isRecord(tile) && isRecord(tile.config) ? tile.config.alert : undefined;
    if (!isRecord(alert)) continue;
    if ('channel' in alert) alert.channel = encodeWebhookName(alert.channel);
    if (Array.isArray(alert.channels)) {
      alert.channels = alert.channels.map(encodeWebhookName);
    }
  }
  return raw;
}

// `complete` is false when the directory or any file in it could not be read
// or validated, so the caller cannot tell which dashboards the files declare.
function readDashboardDir(dir: string): {
  dashboards: DashboardWithoutId[];
  complete: boolean;
} {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (err) {
    logger.error({ err, dir }, 'Failed to read dashboard directory');
    return { dashboards: [], complete: false };
  }

  const dashboards: DashboardWithoutId[] = [];
  let complete = true;
  for (const file of files) {
    try {
      const raw = encodeWebhookNames(
        migrateLegacyDashboardTileColorsRaw(
          JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')),
        ),
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
        complete = false;
        continue;
      }
      dashboards.push(parsed.data);
    } catch (err) {
      logger.error({ err, file }, 'Failed to parse dashboard file');
      complete = false;
    }
  }
  return { dashboards, complete };
}

export function readDashboardFiles(dir: string): DashboardWithoutId[] {
  return readDashboardDir(dir).dashboards;
}

type AlertChannelInput = { type: 'webhook'; webhookId: string };

// Swaps each `webhookName` reference for the id of the team's webhook with
// that name. A tile whose alert names a missing or ambiguous webhook loses its
// alert, and is reported in `unresolved` so its last valid version is kept.
export function resolveWebhookNames(
  tiles: Tile[],
  webhookIdsByName: Map<string, string[]>,
): { tiles: Tile[]; unresolved: Map<string, string> } {
  const unresolved = new Map<string, string>();
  const resolveChannel = (channel: AlertChannelInput): AlertChannelInput => {
    if (!channel.webhookId.startsWith(WEBHOOK_NAME_REF)) return channel;
    const name = channel.webhookId.slice(WEBHOOK_NAME_REF.length);
    const ids = webhookIdsByName.get(name) ?? [];
    if (ids.length === 0) {
      throw new Error(`Webhook named "${name}" not found`);
    }
    if (ids.length > 1) {
      throw new Error(
        `Webhook name "${name}" matches ${ids.length} webhooks; use webhookId`,
      );
    }
    return { ...channel, webhookId: ids[0] };
  };

  const resolved = tiles.map((tile): Tile => {
    const alert = tile.config.alert;
    if (alert == null) return tile;
    try {
      return {
        ...tile,
        config: {
          ...tile.config,
          alert: {
            ...alert,
            ...(alert.channel && { channel: resolveChannel(alert.channel) }),
            ...(alert.channels && {
              channels: alert.channels.map(resolveChannel),
            }),
          },
        },
      };
    } catch (err) {
      unresolved.set(tile.id, err instanceof Error ? err.message : String(err));
      const { alert: _alert, ...config } = tile.config;
      return { ...tile, config };
    }
  });
  return { tiles: resolved, unresolved };
}

// Turns the `config.alert` of each provisioned tile into a tile alert, the way
// saving a dashboard through the API does. An alert that fails validation, or
// is listed in `unresolved`, is skipped and keeps its last valid version; a
// provisioned alert whose tile no longer declares one is removed. Alerts
// created in the app are left alone.
export async function syncProvisionedAlerts(
  dashboard: Pick<IDashboard, '_id' | 'name' | 'tags' | 'tiles'>,
  teamId: string,
  tiles: Tile[],
  unresolved: Map<string, string> = new Map(),
) {
  const team = new Types.ObjectId(teamId);
  const declared = tiles.filter(tile => tile.config.alert != null);

  for (const [tileId, reason] of unresolved) {
    logger.warn(
      { name: dashboard.name, tileId, err: reason },
      'Skipping invalid provisioned tile alert',
    );
  }

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
    tileId: {
      $nin: [...declared.map(tile => tile.id), ...unresolved.keys()],
    },
  });
}

// Provisioned dashboards outlive their files, but their provisioned alerts
// must not: a removed or renamed file would otherwise keep notifying. Only
// called once every file in the directory was read, so a file that is briefly
// invalid does not lose its alerts.
export async function deleteOrphanedProvisionedAlerts(
  teamId: string,
  declaredNames: string[],
) {
  const orphaned = await Dashboard.find(
    { team: teamId, provisioned: true, name: { $nin: declaredNames } },
    { _id: 1, name: 1 },
  ).lean();
  if (orphaned.length === 0) return;

  const { deletedCount } = await Alert.deleteMany({
    team: teamId,
    source: AlertSource.TILE,
    provisioned: true,
    dashboard: { $in: orphaned.map(d => d._id) },
  });
  if (deletedCount > 0) {
    logger.info(
      { teamId, deletedCount, dashboards: orphaned.map(d => d.name) },
      'Deleted provisioned alerts of dashboards no longer in the provisioner directory',
    );
  }
}

export async function syncDashboards(teamId: string, dir: string) {
  const { dashboards, complete } = readDashboardDir(dir);
  // An empty directory is more likely a failed mount than an intent to drop
  // every provisioned alert, so orphan cleanup needs at least one file.
  if (dashboards.length === 0) return;

  const webhookIdsByName = new Map<string, string[]>();
  const webhooks = await Webhook.find({ team: teamId }, { name: 1 }).lean();
  for (const webhook of webhooks) {
    const ids = webhookIdsByName.get(webhook.name) ?? [];
    ids.push(webhook._id.toString());
    webhookIdsByName.set(webhook.name, ids);
  }

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

      const { tiles, unresolved } = resolveWebhookNames(
        dashboard.tiles || [],
        webhookIdsByName,
      );

      const result = await Dashboard.findOneAndUpdate(
        { name: dashboard.name, team: teamId, provisioned: true },
        {
          $set: {
            tiles,
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
        await syncProvisionedAlerts(saved, teamId, tiles, unresolved);
      }
    } catch (err) {
      logger.error(
        { err, name: dashboard.name },
        'Failed to provision dashboard',
      );
    }
  }

  if (!complete) {
    logger.warn(
      'Some dashboard files could not be read, skipping cleanup of orphaned provisioned alerts',
    );
    return;
  }
  try {
    await deleteOrphanedProvisionedAlerts(
      teamId,
      dashboards.map(d => d.name),
    );
  } catch (err) {
    logger.error({ err }, 'Failed to clean up orphaned provisioned alerts');
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
