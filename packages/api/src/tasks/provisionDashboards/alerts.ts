import { isPromqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import { Tile } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import {
  AlertInput,
  createOrUpdateDashboardAlerts,
  validateAlertInput,
} from '@/controllers/alerts';
import Alert, { AlertSource } from '@/models/alert';
import Dashboard, { IDashboard } from '@/models/dashboard';
import {
  hasWebhookNames,
  loadWebhookIdsByName,
  resolveWebhookNames,
  withoutAlert,
} from '@/tasks/provisionDashboards/webhookNames';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { internalAlertSchema } from '@/utils/zod';

const skippedAlerts = getCounter('hyperdx.provisioner.tile_alert_skipped', {
  description:
    'Tile alerts declared in a provisioned dashboard file that were not created or updated because they failed validation.',
});

// Runs the checks the alerts API applies, against the tile as the file
// declares it, plus the ones the alert task relies on to evaluate it at all:
// alertable display type, no PromQL, and a source, connection and webhooks
// that exist in this team.
async function validateTileAlert(
  team: Types.ObjectId,
  dashboardId: string,
  tile: Tile,
): Promise<AlertInput> {
  const parsed = internalAlertSchema.safeParse({
    ...tile.config.alert,
    source: AlertSource.TILE,
    dashboardId,
    tileId: tile.id,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '));
  }
  if (isPromqlSavedChartConfig(tile.config)) {
    throw new Error('Alerts are not supported on PromQL tiles');
  }
  const { alert: _alert, ...chartConfig } = tile.config;
  await validateAlertInput(team, {
    source: AlertSource.INLINE,
    chartConfig,
    channel: parsed.data.channel,
    channels: parsed.data.channels,
  });
  return parsed.data;
}

type ProvisionedTiles = {
  tiles: Tile[];
  alertsByTile: Record<string, AlertInput>;
};

// Decides what each declared alert becomes on this sync:
// - valid: stored and created or updated;
// - invalid: the tile keeps its last synced version, query and alert together,
//   so an old alert never evaluates a new query; a new tile is stored without
//   its alert;
// - on a tile that already carries an alert created in the app: skipped, so a
//   file never takes over, or later deletes, a user's alert.
export async function prepareProvisionedTiles(
  teamId: string,
  dashboardId: Types.ObjectId,
  declaredTiles: Tile[],
  storedTiles: Tile[],
): Promise<ProvisionedTiles> {
  const team = new Types.ObjectId(teamId);
  const { tiles, unresolved } = hasWebhookNames(declaredTiles)
    ? resolveWebhookNames(declaredTiles, await loadWebhookIdsByName(teamId))
    : { tiles: declaredTiles, unresolved: new Map<string, string>() };

  const tileIdCounts = new Map<string, number>();
  for (const tile of tiles) {
    tileIdCounts.set(tile.id, (tileIdCounts.get(tile.id) ?? 0) + 1);
  }
  const userAlertTileIds = new Set(
    (
      await Alert.find(
        {
          team,
          dashboard: dashboardId,
          source: AlertSource.TILE,
          provisioned: { $ne: true },
        },
        { tileId: 1 },
      ).lean()
    ).map(a => a.tileId),
  );

  const skip = (tile: Tile, reason: string) => {
    skippedAlerts.add(1);
    logger.warn(
      { teamId, dashboardId, tileId: tile.id, err: reason },
      'Skipping invalid provisioned tile alert',
    );
  };
  const lastSynced = (tile: Tile): Tile =>
    storedTiles.find(stored => stored.id === tile.id) ?? withoutAlert(tile);

  const alertsByTile: Record<string, AlertInput> = {};
  const result: Tile[] = [];
  for (const tile of tiles) {
    const reason = unresolved.get(tile.id);
    if (reason != null) {
      skip(tile, reason);
      result.push(lastSynced(tile));
      continue;
    }
    if (tile.config.alert == null) {
      result.push(tile);
      continue;
    }
    if ((tileIdCounts.get(tile.id) ?? 0) > 1) {
      skip(tile, 'Tile id is not unique in the dashboard');
      result.push(withoutAlert(tile));
      continue;
    }
    if (userAlertTileIds.has(tile.id)) {
      skip(tile, 'Tile already has an alert created in the app');
      result.push(withoutAlert(tile));
      continue;
    }
    try {
      alertsByTile[tile.id] = await validateTileAlert(
        team,
        dashboardId.toString(),
        tile,
      );
      result.push(tile);
    } catch (err) {
      skip(tile, err instanceof Error ? err.message : String(err));
      result.push(lastSynced(tile));
    }
  }
  return { tiles: result, alertsByTile };
}

// Creates or updates the dashboard's valid provisioned alerts, and deletes
// provisioned alerts whose stored tile no longer declares one.
export async function syncProvisionedAlerts(
  dashboard: Pick<IDashboard, '_id' | 'name' | 'tags' | 'tiles'>,
  teamId: string,
  alertsByTile: Record<string, AlertInput>,
) {
  const team = new Types.ObjectId(teamId);
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
      $nin: dashboard.tiles
        .filter(tile => tile.config.alert != null)
        .map(tile => tile.id),
    },
  });
}

// Provisioned dashboards outlive their files, but their provisioned alerts
// must not: a removed or renamed file would otherwise keep notifying. Only
// called once every file in the directory was read and synced, so a file that
// is briefly invalid, or a dashboard that failed to sync, keeps its alerts.
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
