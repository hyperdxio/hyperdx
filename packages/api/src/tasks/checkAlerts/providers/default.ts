import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { Tile } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';
import { URLSearchParams } from 'url';

import * as config from '@/config';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { connectDB, mongooseConnection, ObjectId } from '@/models';
import Alert, { AlertSource, AlertState, type IAlert } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import Connection, { IConnection } from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { type ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { type ISource, Source } from '@/models/source';
import Webhook, { IWebhook } from '@/models/webhook';
import {
  type AlertDetails,
  type AlertProvider,
  type AlertTask,
  AlertTaskType,
} from '@/tasks/checkAlerts/providers';
import { MappedOmit } from '@/tasks/types';
import { convertMsToGranularityString } from '@/utils/common';
import logger from '@/utils/logger';

import { AggregatedAlertHistory, getPreviousAlertHistories } from '..';

type PartialAlertDetails = MappedOmit<AlertDetails, 'previousMap'>;

async function getSavedSearchDetails(
  alert: IAlert,
): Promise<[IConnection, PartialAlertDetails] | []> {
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
): Promise<[IConnection, PartialAlertDetails] | []> {
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

async function loadAlert(
  alert: IAlert,
  groupedTasks: Map<string, AlertTask>,
  previousAlerts: Map<string, AggregatedAlertHistory>,
  now: Date,
) {
  if (!alert.source) {
    throw new Error('alert does not have a source');
  }

  if (config.IS_LOCAL_APP_MODE) {
    // The id is the 12 character string `_local_team_', which will become an ObjectId
    // as the ASCII hex values, so 5f6c6f63616c5f7465616d5f.
    alert.team = new mongoose.Types.ObjectId(LOCAL_APP_TEAM.id);
  }

  let conn: IConnection | undefined;
  let details: PartialAlertDetails | undefined;
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
    groupedTasks.set(conn.id, { alerts: [], conn, now });
  }
  const v = groupedTasks.get(conn.id);
  if (!v) {
    throw new Error(`provider did not set key ${conn.id} before appending`);
  }
  v.alerts.push({ ...details, previousMap: previousAlerts });
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

    const now = new Date();
    const alertIds = alerts.map(({ id }) => id);
    const previousAlerts = await getPreviousAlertHistories(alertIds, now);

    for (const alert of alerts) {
      try {
        await loadAlert(alert, groupedTasks, previousAlerts, now);
      } catch (e) {
        logger.error({
          message: `failed to load alert: ${e}`,
          alertId: alert.id,
          team: alert.team,
          channel: alert.channel,
          provider: 'default',
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

  async updateAlertState(alertId: string, histories: IAlertHistory[]) {
    // Save history records first (in parallel), then update alert state
    // Use Promise.allSettled to handle partial failures gracefully
    const historyResults = await Promise.allSettled(
      histories.map(history => AlertHistory.create(history)),
    );

    // Log any failed history saves but continue with alert state update
    const failedHistories = historyResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedHistories.length > 0) {
      logger.error({
        message: 'Some alert history records failed to save',
        alertId,
        failedCount: failedHistories.length,
        totalCount: histories.length,
        errors: failedHistories.map(f => f.reason),
      });
    }

    // Determine final alert state: use successfully saved histories if any, otherwise fallback to computed state
    // The alert state is ALERT if ANY history (successful or computed) is in ALERT state, otherwise OK
    const successfulHistories = historyResults
      .map((result, index) =>
        result.status === 'fulfilled' ? histories[index] : null,
      )
      .filter((h): h is IAlertHistory => h !== null);

    const historiesToCheck =
      successfulHistories.length > 0 ? successfulHistories : histories;

    const finalState = historiesToCheck.some(h => h.state === AlertState.ALERT)
      ? AlertState.ALERT
      : AlertState.OK;

    // Update alert state based on successfully saved histories
    await Alert.updateOne(
      { _id: new mongoose.Types.ObjectId(alertId) },
      { $set: { state: finalState } },
    );
  }

  async getWebhooks(teamId: string | ObjectId) {
    const webhooks = await Webhook.find({
      team: new mongoose.Types.ObjectId(teamId),
    });
    return new Map<string, IWebhook>(webhooks.map(w => [w.id, w]));
  }

  async getClickHouseClient(
    { host, username, password, id }: IConnection,
    requestTimeout?: number,
  ): Promise<ClickhouseClient> {
    if (!password && password !== '') {
      logger.info({
        message: `connection password not found`,
        connectionId: id,
        provider: 'default',
      });
    }

    return new ClickhouseClient({
      host,
      username,
      password,
      application: `hyperdx-alerts ${config.CODE_VERSION}`,
      requestTimeout: requestTimeout ?? 30_000,
    });
  }
}
