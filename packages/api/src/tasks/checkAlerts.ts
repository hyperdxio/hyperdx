// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import PQueue from '@esm2cjs/p-queue';
import * as clickhouse from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata, Metadata } from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import * as fns from 'date-fns';
import { chunk, isString } from 'lodash';
import { ObjectId } from 'mongoose';
import mongoose from 'mongoose';
import ms from 'ms';
import { serializeError } from 'serialize-error';

import { AlertState, AlertThresholdType, IAlert } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import { IDashboard } from '@/models/dashboard';
import { ISavedSearch } from '@/models/savedSearch';
import { ISource } from '@/models/source';
import { IWebhook } from '@/models/webhook';
import {
  AlertDetails,
  AlertProvider,
  AlertTask,
  AlertTaskType,
  loadProvider,
} from '@/tasks/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateTitle,
  handleSendGenericWebhook,
  renderAlertTemplate,
} from '@/tasks/template';
import { CheckAlertsTaskArgs, HdxTask } from '@/tasks/types';
import { roundDownToXMinutes, unflattenObject } from '@/tasks/util';
import logger from '@/utils/logger';

export const doesExceedThreshold = (
  thresholdType: AlertThresholdType,
  threshold: number,
  value: number,
) => {
  const isThresholdTypeAbove = thresholdType === AlertThresholdType.ABOVE;
  if (isThresholdTypeAbove && value >= threshold) {
    return true;
  } else if (!isThresholdTypeAbove && value < threshold) {
    return true;
  }
  return false;
};

const fireChannelEvent = async ({
  alert,
  alertProvider,
  attributes,
  clickhouseClient,
  dashboard,
  endTime,
  group,
  metadata,
  savedSearch,
  source,
  startTime,
  totalCount,
  windowSizeInMins,
  teamWebhooksById,
}: {
  alert: IAlert;
  alertProvider: AlertProvider;
  attributes: Record<string, string>; // TODO: support other types than string
  clickhouseClient: ClickhouseClient;
  dashboard?: IDashboard | null;
  endTime: Date;
  group?: string;
  metadata: Metadata;
  savedSearch?: ISavedSearch | null;
  source?: ISource | null;
  startTime: Date;
  totalCount: number;
  windowSizeInMins: number;
  teamWebhooksById: Map<string, IWebhook>;
}) => {
  const team = alert.team;
  if (team == null) {
    throw new Error('Team not found');
  }

  if ((alert.silenced?.until?.getTime() ?? 0) > Date.now()) {
    logger.info({
      message: 'Skipped firing alert due to silence',
      alertId: alert.id,
      silenced: alert.silenced,
    });
    return;
  }

  const attributesNested = unflattenObject(attributes);
  const templateView: AlertMessageTemplateDefaultView = {
    alert: {
      channel: alert.channel,
      dashboardId: dashboard?.id,
      groupBy: alert.groupBy,
      interval: alert.interval,
      message: alert.message,
      name: alert.name,
      savedSearchId: savedSearch?.id,
      silenced: alert.silenced,
      source: alert.source,
      threshold: alert.threshold,
      thresholdType: alert.thresholdType,
      tileId: alert.tileId,
    },
    attributes: attributesNested,
    dashboard,
    endTime,
    granularity: `${windowSizeInMins} minute`,
    group,
    savedSearch,
    source,
    startTime,
    value: totalCount,
  };

  await renderAlertTemplate({
    alertProvider,
    clickhouseClient,
    metadata,
    title: buildAlertMessageTemplateTitle({
      template: alert.name,
      view: templateView,
    }),
    template: alert.message,
    view: templateView,
    teamWebhooksById,
  });
};

export const processAlert = async (
  now: Date,
  details: AlertDetails,
  clickhouseClient: ClickhouseClient,
  connectionId: string,
  alertProvider: AlertProvider,
  teamWebhooksById: Map<string, IWebhook>,
) => {
  const { alert, source, previous } = details;
  try {
    const windowSizeInMins = ms(alert.interval) / 60000;
    const nowInMinsRoundDown = roundDownToXMinutes(windowSizeInMins)(now);
    if (
      previous &&
      fns.getTime(previous.createdAt) === fns.getTime(nowInMinsRoundDown)
    ) {
      logger.info({
        message: `Skipped to check alert since the time diff is still less than 1 window size`,
        windowSizeInMins,
        nowInMinsRoundDown,
        previous,
        now,
        alertId: alert.id,
      });
      return;
    }
    const checkStartTime = previous
      ? previous.createdAt
      : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins);
    const checkEndTime = nowInMinsRoundDown;

    let chartConfig: ChartConfigWithOptDateRange | undefined;
    if (details.taskType === AlertTaskType.SAVED_SEARCH) {
      const savedSearch = details.savedSearch;
      chartConfig = {
        connection: connectionId,
        displayType: DisplayType.Line,
        dateRange: [checkStartTime, checkEndTime],
        dateRangeStartInclusive: true,
        dateRangeEndInclusive: false,
        from: source.from,
        granularity: `${windowSizeInMins} minute`,
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            valueExpression: '',
          },
        ],
        where: savedSearch.where,
        whereLanguage: savedSearch.whereLanguage,
        groupBy: alert.groupBy,
        implicitColumnExpression: source.implicitColumnExpression,
        timestampValueExpression: source.timestampValueExpression,
      };
    } else if (details.taskType === AlertTaskType.TILE) {
      const tile = details.tile;
      // Doesn't work for metric alerts yet
      if (tile.config.displayType === DisplayType.Line) {
        chartConfig = {
          connection: connectionId,
          dateRange: [checkStartTime, checkEndTime],
          dateRangeStartInclusive: true,
          dateRangeEndInclusive: false,
          displayType: tile.config.displayType,
          from: source.from,
          granularity: `${windowSizeInMins} minute`,
          groupBy: tile.config.groupBy,
          implicitColumnExpression: source.implicitColumnExpression,
          metricTables: source.metricTables,
          select: tile.config.select,
          timestampValueExpression: source.timestampValueExpression,
          where: tile.config.where,
          seriesReturnType: tile.config.seriesReturnType,
        };
      }
    } else {
      logger.error({
        message: `Unsupported alert source: ${alert.source}`,
        alertId: alert.id,
      });
      return;
    }

    // Fetch data
    if (chartConfig == null) {
      logger.error({
        message: 'Failed to build chart config',
        chartConfig,
        alertId: alert.id,
      });
      return;
    }

    const metadata = getMetadata(clickhouseClient);
    const checksData = await clickhouseClient.queryChartConfig({
      config: chartConfig,
      metadata,
    });

    logger.info({
      message: `Received alert metric [${alert.source} source]`,
      alertId: alert.id,
      checksData,
      checkStartTime,
      checkEndTime,
    });

    // TODO: support INSUFFICIENT_DATA state
    const history: IAlertHistory = {
      alert: new mongoose.Types.ObjectId(alert.id),
      createdAt: nowInMinsRoundDown,
      state: AlertState.OK,
      counts: 0,
      lastValues: [],
    };

    if (checksData?.data && checksData?.data.length > 0) {
      // attach JS type
      const meta =
        checksData.meta?.map(m => ({
          ...m,
          jsType: clickhouse.convertCHDataTypeToJSType(m.type),
        })) ?? [];

      const timestampColumnName = meta.find(
        m => m.jsType === clickhouse.JSDataType.Date,
      )?.name;
      const valueColumnNames = new Set(
        meta
          .filter(m => m.jsType === clickhouse.JSDataType.Number)
          .map(m => m.name),
      );

      if (timestampColumnName == null) {
        logger.error({
          message: 'Failed to find timestamp column',
          meta,
          alertId: alert.id,
        });
        return;
      }
      if (valueColumnNames.size === 0) {
        logger.error({
          message: 'Failed to find value column',
          meta,
          alertId: alert.id,
        });
        return;
      }

      for (const checkData of checksData.data) {
        let _value: number | null = null;
        const extraFields: string[] = [];
        // TODO: other keys should be attributes ? (for alert message template)
        for (const [k, v] of Object.entries(checkData)) {
          if (valueColumnNames.has(k)) {
            _value = isString(v) ? parseInt(v) : v;
          } else if (k !== timestampColumnName) {
            extraFields.push(`${k}:${v}`);
          }
        }

        // TODO: we might want to fix the null value from the upstream (check if this is still needed)
        // this happens when the ratio is 0/0
        if (_value == null) {
          continue;
        }
        const bucketStart = new Date(checkData[timestampColumnName]);
        if (doesExceedThreshold(alert.thresholdType, alert.threshold, _value)) {
          history.state = AlertState.ALERT;
          logger.info({
            message: `Triggering ${alert.channel.type} alarm!`,
            alertId: alert.id,
            totalCount: _value,
            checkData,
          });

          try {
            // Casts to any here because this is where I stopped unraveling the
            // alert logic requiring large, nested objects. We should look at
            // cleaning this up next. fireChannelEvent guards against null values
            // for these properties.
            await fireChannelEvent({
              alert,
              alertProvider,
              attributes: {}, // FIXME: support attributes (logs + resources ?)
              clickhouseClient,
              dashboard: (details as any).dashboard,
              endTime: fns.addMinutes(bucketStart, windowSizeInMins),
              group: extraFields.join(', '),
              metadata,
              savedSearch: (details as any).savedSearch,
              source,
              startTime: bucketStart,
              totalCount: _value,
              windowSizeInMins,
              teamWebhooksById,
            });
          } catch (e) {
            logger.error({
              message: 'Failed to fire channel event',
              alertId: alert.id,
              error: serializeError(e),
            });
          }

          history.counts += 1;
        }
        history.lastValues.push({ count: _value, startTime: bucketStart });
      }
    }

    await alertProvider.updateAlertState(history);
  } catch (e) {
    // Uncomment this for better error messages locally
    // console.error(e);
    logger.error({
      message: 'Failed to process alert',
      alertId: alert.id,
      error: serializeError(e),
    });
  }
};

// Re-export handleSendGenericWebhook for testing
export { handleSendGenericWebhook };

export interface AggregatedAlertHistory {
  _id: ObjectId;
  createdAt: Date;
}

/**
 * Fetch the most recent AlertHistory value for each of the given alert IDs.
 *
 * @param alertIds The list of alert IDs to query the latest history for.
 * @param now The current date and time. AlertHistory documents that have a createdBy > now are ignored.
 * @returns A map from Alert IDs to their most recent AlertHistory. If there are no
 *  AlertHistory documents for an Alert ID, that ID will not be a key in the map.
 */
export const getPreviousAlertHistories = async (
  alertIds: string[],
  now: Date,
) => {
  // Group the alert IDs into chunks of 50 to avoid exceeding MongoDB's recommendation that $in lists be on the order of 10s of items
  const chunkedIds = chunk(
    alertIds.map(id => new mongoose.Types.ObjectId(id)),
    50,
  );

  const resultChunks = await Promise.all(
    chunkedIds.map(async ids =>
      AlertHistory.aggregate<AggregatedAlertHistory>([
        // Filter for the given alerts, and only entries created before "now"
        {
          $match: {
            alert: { $in: ids },
            createdAt: { $lte: now },
          },
        },
        // Group by alert ID, taking the latest createdAt value for each group
        {
          $group: {
            _id: '$alert',
            createdAt: { $max: '$createdAt' },
          },
        },
      ]),
    ),
  );

  return new Map<string, AggregatedAlertHistory>(
    resultChunks.flat().map(history => [history._id.toString(), history]),
  );
};

export default class CheckAlertTask implements HdxTask<CheckAlertsTaskArgs> {
  private provider!: AlertProvider;
  private task_queue: PQueue;

  constructor(private args: CheckAlertsTaskArgs) {
    const concurrency = this.args.concurrency;
    this.task_queue = new PQueue({
      autoStart: true,
      ...(concurrency ? { concurrency } : null),
    });
  }

  async processAlertTask(
    alertTask: AlertTask,
    teamWebhooksById: Map<string, IWebhook>,
  ) {
    const { alerts, conn } = alertTask;
    logger.info({
      message: 'Processing alerts in batch',
      alertCount: alerts.length,
    });

    if (!conn.password && conn.password !== '') {
      const providerName = this.provider.constructor.name;
      logger.info({
        message: `alert provider did not fetch connection password`,
        providerName,
        connectionId: conn.id,
      });
    }

    const clickhouseClient = new ClickhouseClient({
      host: conn.host,
      username: conn.username,
      password: conn.password,
    });

    for (const alert of alerts) {
      await this.task_queue.add(() =>
        processAlert(
          alertTask.now,
          alert,
          clickhouseClient,
          conn.id,
          this.provider,
          teamWebhooksById,
        ),
      );
    }
  }

  async execute(): Promise<void> {
    if (this.args.taskName !== 'check-alerts') {
      throw new Error(
        `CheckAlertTask can only handle 'check-alerts' tasks, received: ${this.args.taskName}`,
      );
    }

    this.provider = await loadProvider(this.args.provider);
    await this.provider.init();

    const alertTasks = await this.provider.getAlertTasks();
    logger.info({
      message: 'Fetched alert tasks to process',
      taskCount: alertTasks.length,
    });

    const teams = new Set(alertTasks.map(t => t.conn.team.toString()));
    const teamToWebhooks = new Map<string, Map<string, IWebhook>>();
    for (const teamId of teams) {
      const teamWebhooksById = await this.provider.getWebhooks(teamId);
      teamToWebhooks.set(teamId, teamWebhooksById);
    }

    for (const task of alertTasks) {
      const teamWebhooksById =
        teamToWebhooks.get(task.conn.team.toString()) ?? new Map();
      await this.task_queue.add(() =>
        this.processAlertTask(task, teamWebhooksById),
      );
    }

    await this.task_queue.onIdle();
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {
    if (this.provider) {
      await this.provider.asyncDispose();
    }
  }
}
