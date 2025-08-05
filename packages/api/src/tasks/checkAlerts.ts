// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import * as clickhouse from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata, Metadata } from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import * as fns from 'date-fns';
import _ from 'lodash';
import { isString } from 'lodash';
import ms from 'ms';
import { serializeError } from 'serialize-error';

import { getConnectionById } from '@/controllers/connection';
import {
  AlertDocument,
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { ISource, Source } from '@/models/source';
import { AlertProvider, loadProvider } from '@/tasks/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateTitle,
  handleSendGenericWebhook,
  renderAlertTemplate,
} from '@/tasks/template';
import { HdxTask, TaskArgs } from '@/tasks/types';
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
}: {
  alert: AlertDocument;
  alertProvider: AlertProvider;
  attributes: Record<string, string>; // TODO: support other types than string
  clickhouseClient: clickhouse.ClickhouseClient;
  dashboard?: IDashboard | null;
  endTime: Date;
  group?: string;
  metadata: Metadata;
  savedSearch?: ISavedSearch | null;
  source?: ISource | null;
  startTime: Date;
  totalCount: number;
  windowSizeInMins: number;
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
    team: {
      id: team._id.toString(),
    },
  });
};

export const processAlert = async (
  now: Date,
  alert: AlertDocument,
  alertProvider: AlertProvider,
) => {
  try {
    const previous: IAlertHistory | undefined = (
      await AlertHistory.find({ alert: alert._id })
        .sort({ createdAt: -1 })
        .limit(1)
    )[0];

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
    let connectionId: string | undefined;
    let savedSearch: ISavedSearch | undefined | null;
    let dashboard: IDashboard | undefined | null;
    let source: ISource | undefined | null;
    // SAVED_SEARCH Source
    if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
      savedSearch = await SavedSearch.findById(alert.savedSearch);
      if (savedSearch == null) {
        logger.error({
          message: 'SavedSearch not found',
          alertId: alert.id,
        });
        return;
      }
      source = await Source.findById(savedSearch.source);
      if (source == null) {
        logger.error({
          message: 'Source not found',
          alertId: alert.id,
          savedSearch: alert.savedSearch,
        });
        return;
      }
      connectionId = source.connection.toString();
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
    }
    // TILE Source
    else if (
      alert.source === AlertSource.TILE &&
      alert.dashboard &&
      alert.tileId
    ) {
      dashboard = await Dashboard.findById(alert.dashboard);
      if (dashboard == null) {
        logger.error({
          message: 'Dashboard not found',
          alertId: alert.id,
          dashboardId: alert.dashboard,
        });
        return;
      }
      // filter tiles
      dashboard.tiles = dashboard.tiles.filter(
        tile => tile.id === alert.tileId,
      );

      if (dashboard.tiles.length === 1) {
        // Doesn't work for metric alerts yet
        const MAX_NUM_GROUPS = 20;
        // TODO: assuming that the chart has only 1 series for now
        const firstTile = dashboard.tiles[0];
        if (firstTile.config.displayType === DisplayType.Line) {
          // fetch source data
          source = await Source.findById(firstTile.config.source);
          if (!source) {
            logger.error({
              message: 'Source not found',
              dashboardId: alert.dashboard,
              tile: firstTile,
            });
            return;
          }
          connectionId = source.connection.toString();
          chartConfig = {
            connection: connectionId,
            dateRange: [checkStartTime, checkEndTime],
            dateRangeStartInclusive: true,
            dateRangeEndInclusive: false,
            displayType: firstTile.config.displayType,
            from: source.from,
            granularity: `${windowSizeInMins} minute`,
            groupBy: firstTile.config.groupBy,
            implicitColumnExpression: source.implicitColumnExpression,
            metricTables: source.metricTables,
            select: firstTile.config.select,
            timestampValueExpression: source.timestampValueExpression,
            where: firstTile.config.where,
            seriesReturnType: firstTile.config.seriesReturnType,
          };
        }
      }
    } else {
      logger.error({
        message: `Unsupported alert source: ${alert.source}`,
        alertId: alert.id,
      });
      return;
    }

    // Fetch data
    if (chartConfig == null || connectionId == null) {
      logger.error({
        message: 'Failed to build chart config',
        chartConfig,
        connectionId,
        alertId: alert.id,
      });
      return;
    }

    const connection = await getConnectionById(
      alert.team._id.toString(),
      connectionId,
      true,
    );

    if (connection == null) {
      logger.error({
        message: 'Connection not found',
        alertId: alert.id,
      });
      return;
    }
    const clickhouseClient = new clickhouse.ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
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
    let alertState = AlertState.OK;
    const history = await new AlertHistory({
      alert: alert._id,
      createdAt: nowInMinsRoundDown,
      state: alertState,
    }).save();

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
          alertState = AlertState.ALERT;
          logger.info({
            message: `Triggering ${alert.channel.type} alarm!`,
            alertId: alert.id,
            totalCount: _value,
            checkData,
          });

          try {
            await fireChannelEvent({
              alert,
              alertProvider,
              attributes: {}, // FIXME: support attributes (logs + resources ?)
              clickhouseClient,
              dashboard,
              endTime: fns.addMinutes(bucketStart, windowSizeInMins),
              group: extraFields.join(', '),
              metadata,
              savedSearch,
              source,
              startTime: bucketStart,
              totalCount: _value,
              windowSizeInMins,
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

      history.state = alertState;
      await history.save();
    }

    alert.state = alertState;
    await alert.save();
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

export default class CheckAlertTask implements HdxTask {
  private provider!: AlertProvider;

  async execute(args: TaskArgs): Promise<void> {
    this.provider = await loadProvider(args.provider);
    await this.provider.init();

    const now = new Date();
    const alertTasks = await this.provider.getAlertTasks();
    const alerts = alertTasks[0].alerts;
    logger.info(`Going to process ${alerts.length} alerts`);
    await Promise.all(
      alerts.map(alert => processAlert(now, alert, this.provider)),
    );
  }

  async asyncDispose(): Promise<void> {
    if (this.provider) {
      await this.provider.asyncDispose();
    }
  }
}
