import { Tile } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';
import { URLSearchParams } from 'url';

import * as config from '@/config';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { connectDB, mongooseConnection } from '@/models';
import Alert, { AlertSource, type IAlert } from '@/models/alert';
import Connection, { IConnection } from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { type ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { type ISource, Source } from '@/models/source';
import {
  type AlertDetails,
  type AlertProvider,
  type AlertTask,
  AlertTaskType,
} from '@/tasks/providers';
import { convertMsToGranularityString } from '@/utils/common';
import logger from '@/utils/logger';

async function getSavedSearchDetails(
  alert: IAlert,
): Promise<[IConnection, AlertDetails] | []> {
  const savedSearchId = alert.savedSearch;
  const savedSearch = await SavedSearch.findOne({
    _id: savedSearchId,
    team: alert.team,
  }).populate<Omit<ISavedSearch, 'source'> & { source: ISource }>({
    path: 'source',
    match: { team: alert.team },
  });

  if (!savedSearch) {
    logger.error({
      message: 'savedSearch not found',
      savedSearchId,
      alertId: alert.id,
    });
    return [];
  }

  const { source } = savedSearch;
  const connId = source.connection;
  const conn = await Connection.findOne({
    _id: connId,
    team: alert.team,
  }).select('+password');
  if (!conn) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      connId,
      savedSearchId,
    });
    return [];
  }

  return [
    conn,
    {
      alert,
      source,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
    },
  ];
}

async function getTileDetails(
  alert: IAlert,
): Promise<[IConnection, AlertDetails] | []> {
  const dashboardId = alert.dashboard;
  const tileId = alert.tileId;

  const dashboard = await Dashboard.findOne({
    _id: dashboardId,
    team: alert.team,
  });
  if (!dashboard) {
    logger.error({
      message: 'dashboard not found',
      dashboardId,
      alertId: alert.id,
    });
    return [];
  }

  const tile = dashboard.tiles?.find((t: Tile) => t.id === tileId);
  if (!tile) {
    logger.error({
      message: 'tile matching alert not found',
      tileId,
      dashboardId: dashboard._id,
      alertId: alert.id,
    });
    return [];
  }

  const source = await Source.findOne({
    _id: tile.config.source,
    team: alert.team,
  }).populate<Omit<ISource, 'connection'> & { connection: IConnection }>({
    path: 'connection',
    match: { team: alert.team },
    select: '+password',
  });
  if (!source) {
    logger.error({
      message: 'source not found',
      sourceId: tile.config.source,
      tileId,
      dashboardId: dashboard._id,
      alertId: alert.id,
    });
    return [];
  }

  if (!source.connection) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      tileId,
      dashboardId: dashboard._id,
      sourceId: source.id,
    });
    return [];
  }

  const connection = source.connection;
  const sourceProps = source.toObject();
  return [
    connection,
    {
      alert,
      source: { ...sourceProps, connection: connection.id },
      taskType: AlertTaskType.TILE,
      tile,
      dashboard,
    },
  ];
}

async function loadAlert(alert: IAlert, groupedTasks: Map<string, AlertTask>) {
  if (!alert.source) {
    throw new Error('alert does not have a source');
  }

  if (config.IS_LOCAL_APP_MODE) {
    // The id is the 12 character string `_local_team_', which will become an ObjectId
    // as the ASCII hex values, so 5f6c6f63616c5f7465616d5f.
    alert.team = new mongoose.Types.ObjectId(LOCAL_APP_TEAM.id);
  }

  let conn: IConnection | undefined;
  let details: AlertDetails | undefined;
  switch (alert.source) {
    case AlertSource.SAVED_SEARCH:
      [conn, details] = await getSavedSearchDetails(alert);
      break;

    case AlertSource.TILE:
      [conn, details] = await getTileDetails(alert);
      break;

    default:
      throw new Error(`unsupported source: ${alert.source}`);
  }

  if (!details) {
    throw new Error('failed to fetch alert details');
  }

  if (!conn) {
    throw new Error('failed to fetch alert connection');
  }

  if (!groupedTasks.has(conn.id)) {
    groupedTasks.set(conn.id, { alerts: [], conn });
  }
  const v = groupedTasks.get(conn.id);
  if (!v) {
    throw new Error(`provider did not set key ${conn.id} before appending`);
  }
  v.alerts.push(details);
}

export default class DefaultAlertProvider implements AlertProvider {
  async init() {
    await Promise.all([connectDB()]);
  }

  async asyncDispose() {
    await Promise.all([mongooseConnection.close()]);
  }

  async getAlertTasks(): Promise<AlertTask[]> {
    const groupedTasks = new Map<string, AlertTask>();
    const alerts = await Alert.find({});
    for (const alert of alerts) {
      try {
        await loadAlert(alert, groupedTasks);
      } catch (e) {
        logger.error({
          message: `failed to load alert: ${e}`,
          alertId: alert.id,
          team: alert.team,
          channel: alert.channel,
        });
      }
    }

    // Flatten out our groupings for execution
    return Array.from(groupedTasks.values());
  }

  buildLogSearchLink({
    endTime,
    savedSearch,
    startTime,
  }: {
    endTime: Date;
    savedSearch: ISavedSearch;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/search/${savedSearch.id}`);
    const queryParams = new URLSearchParams({
      from: startTime.getTime().toString(),
      to: endTime.getTime().toString(),
      isLive: 'false',
    });
    url.search = queryParams.toString();
    return url.toString();
  }

  buildChartLink({
    dashboardId,
    endTime,
    granularity,
    startTime,
  }: {
    dashboardId: string;
    endTime: Date;
    granularity: string;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/dashboards/${dashboardId}`);
    // extend both start and end time by 7x granularity
    const from = (startTime.getTime() - ms(granularity) * 7).toString();
    const to = (endTime.getTime() + ms(granularity) * 7).toString();
    const queryParams = new URLSearchParams({
      from,
      granularity: convertMsToGranularityString(ms(granularity)),
      to,
    });
    url.search = queryParams.toString();
    return url.toString();
  }
}
