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
  const savedSearch = await SavedSearch.findById(savedSearchId).populate<
    Omit<ISavedSearch, 'source'> & { source: ISource }
  >('source');

  if (!savedSearch) {
    logger.error(`savedSearch not found: id=${savedSearchId}`);
    return [];
  }

  const { source } = savedSearch;
  const connId = source.connection;
  const conn = await Connection.findById(connId);
  if (!conn) {
    logger.error(
      `connection not found: alertId=${alert._id}, connId=${connId}, savedSearchId=${savedSearchId}`,
    );
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

  const dashboard = await Dashboard.findById(dashboardId);
  if (!dashboard) {
    logger.error(`dashboard not found: id=${dashboardId}`);
    return [];
  }

  const tile = dashboard.tiles?.find((t: Tile) => t.id === tileId);
  if (!tile) {
    logger.error(
      `tile matching alert not found: tile=${tileId},alert=${alert._id}`,
    );
    return [];
  }

  const source = await Source.findById(tile.config.source).populate<
    Omit<ISource, 'connection'> & { connection: IConnection }
  >('connection');
  if (!source) {
    logger.error(`source not found: id=${tile.config.source}`);
    return [];
  }

  if (!source.connection) {
    logger.error(
      `connection not found: alert=${alert._id}, source=${source.id}`,
    );
    return [];
  }

  const connection = source.connection;
  const sourceProps = source.toObject();
  return [
    connection,
    {
      alert,
      source: { ...sourceProps, connection: connection._id.toString() },
      taskType: AlertTaskType.TILE,
      tile,
      dashboard,
    },
  ];
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
      if (!alert.source) {
        logger.error(`alert does not have a source: alertId=${alert._id}`);
        continue;
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
          logger.error(
            `unsupported source: alertId=${alert._id}, source=${alert.source}`,
          );
          continue;
      }

      if (!details) {
        logger.error(`failed to fetch alert details: alertId=${alert._id}`);
        continue;
      }

      if (!conn) {
        logger.error(`failed to fetch alert connection: alertId=${alert._id}`);
        continue;
      }

      const k = conn._id.toString();
      if (!groupedTasks.has(k)) {
        groupedTasks.set(k, { alerts: [], conn });
      }
      groupedTasks.get(k)?.alerts.push(details);
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
