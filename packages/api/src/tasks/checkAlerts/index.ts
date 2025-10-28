// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import PQueue from '@esm2cjs/p-queue';
import * as clickhouse from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  getMetadata,
  Metadata,
} from '@hyperdx/common-utils/dist/core/metadata';
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

import Alert, { AlertState, AlertThresholdType, IAlert } from '@/models/alert';
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
} from '@/tasks/checkAlerts/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateTitle,
  handleSendGenericWebhook,
  renderAlertTemplate,
} from '@/tasks/checkAlerts/template';
import { tasksTracer } from '@/tasks/tracer';
import { CheckAlertsTaskArgs, HdxTask } from '@/tasks/types';
import {
  calcAlertDateRange,
  roundDownToXMinutes,
  unflattenObject,
} from '@/tasks/util';
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
  state,
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
  state: AlertState;
  totalCount: number;
  windowSizeInMins: number;
  teamWebhooksById: Map<string, IWebhook>;
}) => {
  const team = alert.team;
  if (team == null) {
    throw new Error('Team not found');
  }

  if ((alert.silenced?.until?.getTime() ?? 0) > Date.now()) {
    logger.info(
      {
        alertId: alert.id,
        silenced: alert.silenced,
      },
      'Skipped firing alert due to silence',
    );
    return;
  }

  const attributesNested = unflattenObject(attributes);
  const templateView: AlertMessageTemplateDefaultView = {
    alert: {
      id: alert.id,
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
    state,
    title: buildAlertMessageTemplateTitle({
      template: alert.name,
      view: templateView,
    }),
    template: alert.message,
    view: templateView,
    teamWebhooksById,
  });
};

// Use a delimiter that's unlikely to appear in alert IDs or group names
// MongoDB ObjectIds are hex strings (0-9, a-f), so pipes are safe
const ALERT_GROUP_DELIMITER = '||';

/**
 * Compute a composite map key for tracking alert history per group.
 * For non-grouped alerts, returns just the alert ID.
 * For grouped alerts, returns "alertId||groupKey" to track per-group state.
 * Uses || as delimiter since it's unlikely to appear in alert IDs (MongoDB ObjectIds)
 * or in typical group key values.
 */
const computeHistoryMapKey = (alertId: string, groupKey: string): string => {
  return groupKey ? `${alertId}${ALERT_GROUP_DELIMITER}${groupKey}` : alertId;
};

/**
 * Extract the group key from a composite history map key.
 * Safely handles group names that may contain colons or other special characters
 * by using the alert ID prefix with the delimiter to identify the split point.
 */
const extractGroupKeyFromMapKey = (mapKey: string, alertId: string): string => {
  const alertIdPrefix = `${alertId}${ALERT_GROUP_DELIMITER}`;
  return mapKey.startsWith(alertIdPrefix)
    ? mapKey.substring(alertIdPrefix.length)
    : '';
};

export const processAlert = async (
  now: Date,
  details: AlertDetails,
  clickhouseClient: ClickhouseClient,
  connectionId: string,
  alertProvider: AlertProvider,
  teamWebhooksById: Map<string, IWebhook>,
) => {
  const { alert, source, previous, previousMap } = details;
  try {
    const windowSizeInMins = ms(alert.interval) / 60000;
    const nowInMinsRoundDown = roundDownToXMinutes(windowSizeInMins)(now);
    if (
      previous &&
      fns.getTime(previous.createdAt) === fns.getTime(nowInMinsRoundDown)
    ) {
      logger.info(
        {
          windowSizeInMins,
          nowInMinsRoundDown,
          previous,
          now,
          alertId: alert.id,
        },
        `Skipped to check alert since the time diff is still less than 1 window size`,
      );
      return;
    }
    const dateRange = calcAlertDateRange(
      (previous
        ? previous.createdAt
        : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins)
      ).getTime(),
      nowInMinsRoundDown.getTime(),
      windowSizeInMins,
    );

    let chartConfig: ChartConfigWithOptDateRange | undefined;
    if (details.taskType === AlertTaskType.SAVED_SEARCH) {
      const savedSearch = details.savedSearch;
      chartConfig = {
        connection: connectionId,
        displayType: DisplayType.Line,
        dateRange,
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
          dateRange,
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
      logger.error(
        {
          alertId: alert.id,
        },
        `Unsupported alert source: ${alert.source}`,
      );
      return;
    }

    // Fetch data
    if (chartConfig == null) {
      logger.error(
        {
          chartConfig,
          alertId: alert.id,
        },
        'Failed to build chart config',
      );
      return;
    }

    const metadata = getMetadata(clickhouseClient);
    const checksData = await clickhouseClient.queryChartConfig({
      config: chartConfig,
      metadata,
    });

    logger.info(
      {
        alertId: alert.id,
        chartConfig,
        checksData,
        checkStartTime: dateRange[0],
        checkEndTime: dateRange[1],
      },
      `Received alert metric [${alert.source} source]`,
    );

    // TODO: support INSUFFICIENT_DATA state
    // Track state per group (or one history if no groupBy)
    const histories = new Map<string, IAlertHistory>();
    const hasGroupBy = alert.groupBy && alert.groupBy.length > 0;

    // Helper to get or create history for a group
    const getOrCreateHistory = (groupKey: string): IAlertHistory => {
      if (!histories.has(groupKey)) {
        histories.set(groupKey, {
          alert: new mongoose.Types.ObjectId(alert.id),
          createdAt: nowInMinsRoundDown,
          state: AlertState.OK,
          counts: 0,
          lastValues: [],
          group: groupKey || undefined,
        });
      }
      return histories.get(groupKey)!;
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
        logger.error(
          {
            meta,
            alertId: alert.id,
          },
          'Failed to find timestamp column',
        );
        return;
      }
      if (valueColumnNames.size === 0) {
        logger.error(
          {
            meta,
            alertId: alert.id,
          },
          'Failed to find value column',
        );
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

        // Group key is the joined extraFields for group-by alerts, or empty string for non-grouped
        const groupKey = hasGroupBy ? extraFields.join(', ') : '';
        const history = getOrCreateHistory(groupKey);

        const bucketStart = new Date(checkData[timestampColumnName]);
        if (doesExceedThreshold(alert.thresholdType, alert.threshold, _value)) {
          history.state = AlertState.ALERT;
          logger.info(
            {
              alertId: alert.id,
              group: groupKey,
              totalCount: _value,
              checkData,
            },
            `Triggering ${alert.channel.type} alarm!`,
          );

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
              group: groupKey,
              metadata,
              savedSearch: (details as any).savedSearch,
              source,
              startTime: bucketStart,
              state: AlertState.ALERT,
              totalCount: _value,
              windowSizeInMins,
              teamWebhooksById,
            });
          } catch (e) {
            logger.error(
              {
                alertId: alert.id,
                group: groupKey,
                error: serializeError(e),
              },
              'Failed to fire channel event',
            );
          }

          history.counts += 1;
        }
        history.lastValues.push({ count: _value, startTime: bucketStart });
      }
    }

    // Handle missing groups: If current check found no data, check if any previously alerting groups need to be resolved
    // For group-by alerts, check if any previously alerting groups are missing from current data
    if (hasGroupBy && previousMap && previousMap.size > 0) {
      for (const [previousKey, previousHistory] of previousMap.entries()) {
        const groupKey = extractGroupKeyFromMapKey(previousKey, alert.id);

        // If this group was previously ALERT but is missing from current data, create an OK history
        if (
          previousHistory.state === AlertState.ALERT &&
          !histories.has(groupKey)
        ) {
          logger.info(
            {
              alertId: alert.id,
              group: groupKey,
            },
            `Group "${groupKey}" is missing from current data but was previously alerting - creating OK history`,
          );
          histories.set(groupKey, {
            alert: new mongoose.Types.ObjectId(alert.id),
            createdAt: nowInMinsRoundDown,
            state: AlertState.OK,
            counts: 0,
            lastValues: [],
            group: groupKey || undefined,
          });
        }
      }
    }

    // If no histories exist at all (no current data and no previous alerting groups), create a default OK history
    if (histories.size === 0) {
      histories.set('', {
        alert: new mongoose.Types.ObjectId(alert.id),
        createdAt: nowInMinsRoundDown,
        state: AlertState.OK,
        counts: 0,
        lastValues: [],
        group: undefined,
      });
    }

    // Check for auto-resolve: for each group, check if it transitioned from ALERT to OK
    for (const [groupKey, history] of histories.entries()) {
      const previousKey = computeHistoryMapKey(alert.id, groupKey);
      // Use nullish coalescing to properly handle falsy values in the map
      // Only fallback to 'previous' if the key is not in the map (undefined)
      const groupPrevious = previousMap?.get(previousKey) ?? previous; // Use previousMap first, fallback to previous for backwards compatibility

      if (
        groupPrevious?.state === AlertState.ALERT &&
        history.state === AlertState.OK
      ) {
        logger.info(
          {
            alertId: alert.id,
            group: groupKey,
          },
          `Alert resolved for group "${groupKey}", triggering ${alert.channel.type} notification`,
        );

        try {
          const lastValue = history.lastValues[history.lastValues.length - 1];
          await fireChannelEvent({
            alert,
            alertProvider,
            attributes: {}, // FIXME: support attributes (logs + resources ?)
            clickhouseClient,
            dashboard: (details as any).dashboard,
            endTime: fns.addMinutes(
              lastValue?.startTime || nowInMinsRoundDown,
              windowSizeInMins,
            ),
            group: groupKey,
            metadata,
            savedSearch: (details as any).savedSearch,
            source,
            startTime: lastValue?.startTime || nowInMinsRoundDown,
            state: AlertState.OK,
            totalCount: lastValue?.count || 0,
            windowSizeInMins,
            teamWebhooksById,
          });
        } catch (e) {
          logger.error(
            {
              alertId: alert.id,
              group: groupKey,
              error: serializeError(e),
            },
            'Failed to fire resolved channel event',
          );
        }
      }
    }

    // Save all history records and update alert state
    // The overall alert state is ALERT if ANY group is in ALERT state, otherwise OK
    const overallState = Array.from(histories.values()).some(
      h => h.state === AlertState.ALERT,
    )
      ? AlertState.ALERT
      : AlertState.OK;

    // Save history records first (in parallel), then update alert state only if all succeed
    // This prevents inconsistent state where alert state is updated but history records fail
    const historyRecords = Array.from(histories.values());
    await Promise.all(
      historyRecords.map(history => AlertHistory.create(history)),
    );

    // Only update alert state after all history records are successfully saved
    await Alert.updateOne(
      { _id: new mongoose.Types.ObjectId(alert.id) },
      { $set: { state: overallState } },
    );
  } catch (e) {
    // Uncomment this for better error messages locally
    // console.error(e);
    logger.error(
      {
        alertId: alert.id,
        error: serializeError(e),
      },
      'Failed to process alert',
    );
  }
};

// Re-export handleSendGenericWebhook for testing
export { handleSendGenericWebhook };

export interface AggregatedAlertHistory {
  _id: ObjectId;
  createdAt: Date;
  state: AlertState;
  group?: string;
}

/**
 * Fetch the most recent AlertHistory value for each of the given alert IDs.
 * For group-by alerts, returns the latest history for each group within each alert.
 *
 * @param alertIds The list of alert IDs to query the latest history for.
 * @param now The current date and time. AlertHistory documents that have a createdBy > now are ignored.
 * @returns A map from Alert IDs (or Alert ID + group) to their most recent AlertHistory.
 *  For non-grouped alerts, the key is just the alert ID.
 *  For grouped alerts, the key is "alertId:group" to track per-group state.
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
        // Sort by createdAt descending to get the latest first
        {
          $sort: { createdAt: -1 },
        },
        // Group by alert ID AND group (if present), taking the first (latest) values for each combination
        {
          $group: {
            _id: {
              alert: '$alert',
              group: '$group',
            },
            createdAt: { $first: '$createdAt' },
            state: { $first: '$state' },
            group: { $first: '$group' },
          },
        },
        // Reshape the _id to be just the alert ObjectId for easier consumption
        {
          $project: {
            _id: '$_id.alert',
            createdAt: 1,
            state: 1,
            group: 1,
          },
        },
      ]),
    ),
  );

  // Create a map with composite keys for grouped alerts (alertId||group) or simple keys for non-grouped alerts
  return new Map<string, AggregatedAlertHistory>(
    resultChunks.flat().map(history => {
      const key = computeHistoryMapKey(
        history._id.toString(),
        history.group || '',
      );
      return [key, history];
    }),
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
    await tasksTracer.startActiveSpan('processAlertTask', async span => {
      span.setAttribute(
        'hyperdx.alerts.team.id',
        alertTask.conn.team.toString(),
      );
      span.setAttribute('hyperdx.alerts.connection.id', alertTask.conn.id);

      try {
        const { alerts, conn } = alertTask;
        logger.info(
          {
            alertCount: alerts.length,
          },
          'Processing alerts in batch',
        );

        const clickhouseClient = await this.provider.getClickHouseClient(
          conn,
          this.args.sourceTimeoutMs,
        );

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
      } finally {
        span.end();
      }
    });
  }

  async execute(): Promise<void> {
    if (this.args.taskName !== 'check-alerts') {
      throw new Error(
        `CheckAlertTask can only handle 'check-alerts' tasks, received: ${this.args.taskName}`,
      );
    }

    this.provider = await loadProvider(this.args.provider);
    await this.provider.init();
    logger.debug(
      {
        provider: this.provider.constructor.name,
        args: this.args,
      },
      'finished provider initialization',
    );

    const alertTasks = await this.provider.getAlertTasks();
    const taskCount = alertTasks.length;
    logger.debug(
      {
        taskCount,
        args: this.args,
      },
      `Fetched ${taskCount} alert tasks to process`,
    );

    const teams = new Set(alertTasks.map(t => t.conn.team.toString()));
    const teamToWebhooks = new Map<string, Map<string, IWebhook>>();
    for (const teamId of teams) {
      const teamWebhooksById = await this.provider.getWebhooks(teamId);
      teamToWebhooks.set(teamId, teamWebhooksById);
    }
    logger.debug(
      {
        args: this.args,
        teamCount: teams.size,
        teamWebhookCount: teamToWebhooks.size,
      },
      `Obtained teams and webhooks for all alertTasks`,
    );

    for (const task of alertTasks) {
      const teamWebhooksById =
        teamToWebhooks.get(task.conn.team.toString()) ?? new Map();
      await this.task_queue.add(() =>
        this.processAlertTask(task, teamWebhooksById),
      );
    }
    logger.debug(
      {
        args: this.args,
      },
      'finished scheduling alert tasks on the task_queue',
    );

    await this.task_queue.onIdle();
    logger.info(
      {
        args: this.args,
      },
      'finished processing all tasks on task_queue',
    );
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
