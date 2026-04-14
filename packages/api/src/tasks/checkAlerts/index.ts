// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import PQueue from '@esm2cjs/p-queue';
import * as clickhouse from '@hyperdx/common-utils/dist/clickhouse';
import {
  chSqlToAliasMap,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { tryOptimizeConfigWithMaterializedView } from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  getMetadata,
  Metadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  aliasMapToWithClauses,
  displayTypeSupportsRawSqlAlerts,
  isTimeSeriesDisplayType,
} from '@hyperdx/common-utils/dist/core/utils';
import { timeBucketByGranularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderChartConfig,
  isBuilderSavedChartConfig,
  isRawSqlChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithOptDateRange,
  ChartConfigWithOptDateRange,
  DisplayType,
  getSampleWeightExpression,
  pickSampleWeightExpressionProps,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import * as fns from 'date-fns';
import { isString, pick } from 'lodash';
import { ObjectId } from 'mongoose';
import mongoose from 'mongoose';
import ms from 'ms';
import { serializeError } from 'serialize-error';

import { ALERT_HISTORY_QUERY_CONCURRENCY } from '@/controllers/alertHistory';
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

/**
 * Determine if an alert has group-by behavior.
 * For saved search alerts, groupBy is on alert.groupBy.
 * For tile alerts, groupBy is on tile.config.groupBy.
 */
export const alertHasGroupBy = (details: AlertDetails): boolean => {
  const { alert } = details;
  if (alert.groupBy && alert.groupBy.length > 0) {
    return true;
  }
  if (
    details.taskType === AlertTaskType.TILE &&
    isBuilderSavedChartConfig(details.tile.config) &&
    details.tile.config.groupBy &&
    details.tile.config.groupBy.length > 0
  ) {
    return true;
  }

  // Without a reliable parser, it's difficult to tell if the raw sql contains a
  // group by (besides the group by on the interval), so we'll assume it might
  // in the case of time series charts, and assume it will not in the case of number charts.
  // Group name will just be blank if there are no group by values.
  if (
    details.taskType === AlertTaskType.TILE &&
    isRawSqlSavedChartConfig(details.tile.config)
  ) {
    return details.tile.config.displayType !== DisplayType.Number;
  }
  return false;
};

/**
 * Render a saved search's SELECT to discover column aliases (e.g. `toString(Body) AS body`)
 * and return them as WITH clauses that can be injected into alert/sample-log queries
 * whose own SELECT doesn't include those aliases.
 */
export async function computeAliasWithClauses(
  savedSearch: Pick<ISavedSearch, 'select' | 'where' | 'whereLanguage'>,
  source: ISource,
  metadata: Metadata,
): Promise<BuilderChartConfigWithOptDateRange['with']> {
  const resolvedSelect =
    savedSearch.select ||
    ((source.kind === SourceKind.Log || source.kind === SourceKind.Trace) &&
      source.defaultTableSelectExpression) ||
    '';
  const config: BuilderChartConfigWithOptDateRange = {
    connection: '',
    displayType: DisplayType.Search,
    from: source.from,
    select: resolvedSelect,
    where: savedSearch.where,
    whereLanguage: savedSearch.whereLanguage,
    implicitColumnExpression:
      source.kind === SourceKind.Log || source.kind === SourceKind.Trace
        ? source.implicitColumnExpression
        : undefined,
    ...pickSampleWeightExpressionProps(source),
    timestampValueExpression: source.timestampValueExpression,
  };
  const query = await renderChartConfig(config, metadata, source.querySettings);
  const aliasMap = chSqlToAliasMap(query);
  return aliasMapToWithClauses(aliasMap);
}

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

const normalizeScheduleOffsetMinutes = ({
  alertId,
  scheduleOffsetMinutes,
  windowSizeInMins,
}: {
  alertId: string;
  scheduleOffsetMinutes: number | undefined;
  windowSizeInMins: number;
}) => {
  if (scheduleOffsetMinutes == null) {
    return 0;
  }

  if (!Number.isFinite(scheduleOffsetMinutes)) {
    return 0;
  }

  const normalized = Math.max(0, Math.floor(scheduleOffsetMinutes));
  if (normalized < windowSizeInMins) {
    return normalized;
  }

  const scheduleOffsetInMins = normalized % windowSizeInMins;
  logger.warn(
    {
      alertId,
      scheduleOffsetMinutes,
      normalizedScheduleOffsetMinutes: scheduleOffsetInMins,
      windowSizeInMins,
    },
    'scheduleOffsetMinutes is greater than or equal to the interval and was normalized',
  );
  return scheduleOffsetInMins;
};

const normalizeScheduleStartAt = ({
  alertId,
  scheduleStartAt,
}: {
  alertId: string;
  scheduleStartAt: IAlert['scheduleStartAt'];
}) => {
  if (scheduleStartAt == null) {
    return undefined;
  }

  if (fns.isValid(scheduleStartAt)) {
    return scheduleStartAt;
  }

  logger.warn(
    {
      alertId,
      scheduleStartAt,
    },
    'Invalid scheduleStartAt value detected, ignoring start time schedule',
  );
  return undefined;
};

export const getScheduledWindowStart = (
  now: Date,
  windowSizeInMins: number,
  scheduleOffsetMinutes = 0,
  scheduleStartAt?: Date,
) => {
  if (scheduleStartAt != null) {
    const windowSizeMs = windowSizeInMins * 60 * 1000;
    const elapsedMs = Math.max(0, now.getTime() - scheduleStartAt.getTime());
    const windowCountSinceStart = Math.floor(elapsedMs / windowSizeMs);
    return new Date(
      scheduleStartAt.getTime() + windowCountSinceStart * windowSizeMs,
    );
  }

  if (scheduleOffsetMinutes <= 0) {
    return roundDownToXMinutes(windowSizeInMins)(now);
  }

  const shiftedNow = fns.subMinutes(now, scheduleOffsetMinutes);
  const roundedShiftedNow = roundDownToXMinutes(windowSizeInMins)(shiftedNow);
  return fns.addMinutes(roundedShiftedNow, scheduleOffsetMinutes);
};

const fireChannelEvent = async ({
  alert,
  alertProvider,
  attributes,
  clickhouseClient,
  dashboard,
  endTime,
  group,
  isGroupedAlert,
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
  isGroupedAlert: boolean;
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

  // KNOWN LIMITATION: Alert data (including silenced state) is fetched when the
  // task is queued via AlertProvider, not when it processes. If a user silences
  // an alert after it's queued but before it processes, this execution may still
  // send a notification. Subsequent alert checks will respect the silenced state.
  // This trade-off maintains architectural separation from direct database access.
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
      ...(alert.scheduleOffsetMinutes != null && {
        scheduleOffsetMinutes: alert.scheduleOffsetMinutes,
      }),
      ...(alert.scheduleStartAt != null && {
        scheduleStartAt: alert.scheduleStartAt.toISOString(),
      }),
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
    isGroupedAlert,
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
      state,
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
 * Get the alert key prefix for filtering grouped alert histories.
 * Returns "alertId||" which is used to match all group keys for this alert.
 */
const getAlertKeyPrefix = (alertId: string): string => {
  return `${alertId}${ALERT_GROUP_DELIMITER}`;
};

/**
 * Compute a composite map key for tracking alert history per group.
 * For non-grouped alerts, returns just the alertId.
 * For grouped alerts, returns "alertId||groupKey" to track per-group state.
 * Uses || as delimiter since it's unlikely to appear in alert IDs (MongoDB ObjectIds)
 * or in typical group key values.
 */
const computeHistoryMapKey = (alertId: string, groupKey: string): string => {
  return groupKey ? `${getAlertKeyPrefix(alertId)}${groupKey}` : alertId;
};

/**
 * Extract the group key from a composite history map key.
 * Safely handles group names that may contain colons or other special characters
 * by using the alert ID prefix with the delimiter to identify the split point.
 */
const extractGroupKeyFromMapKey = (mapKey: string, alertId: string): string => {
  const alertIdPrefix = getAlertKeyPrefix(alertId);
  return mapKey.startsWith(alertIdPrefix)
    ? mapKey.substring(alertIdPrefix.length)
    : '';
};

/** Determine if we should skip the alert check based on how recently it was last evaluated. */
const shouldSkipAlertCheck = (
  details: AlertDetails,
  hasGroupBy: boolean,
  nowInMinsRoundDown: Date,
) => {
  const { alert, previousMap } = details;
  const alertKeyPrefix = getAlertKeyPrefix(alert.id);

  // Skip if ANY previous history for this alert was created in the current window
  return Array.from(previousMap.entries()).some(([key, history]) => {
    // For grouped alerts, check any key that starts with alertId prefix
    // or matches the bare alertId (empty group key case).
    // For non-grouped alerts, check exact match with alertId.
    const isMatchingKey = hasGroupBy
      ? key === alert.id || key.startsWith(alertKeyPrefix)
      : key === alert.id;

    return (
      isMatchingKey &&
      fns.getTime(history.createdAt) === fns.getTime(nowInMinsRoundDown)
    );
  });
};

/** Get the date range for evaluating the alert */
const getAlertEvaluationDateRange = (
  { alert, previousMap }: AlertDetails,
  hasGroupBy: boolean,
  nowInMinsRoundDown: Date,
  windowSizeInMins: number,
  scheduleStartAt?: Date,
) => {
  // Calculate date range for the query
  // Find the latest createdAt among all histories for this alert
  let previousCreatedAt: Date | undefined;
  if (hasGroupBy) {
    // For grouped alerts, find the latest createdAt among all groups.
    // Also check the bare alertId key for the empty group key case.
    const alertKeyPrefix = getAlertKeyPrefix(alert.id);
    for (const [key, history] of previousMap.entries()) {
      if (key === alert.id || key.startsWith(alertKeyPrefix)) {
        if (!previousCreatedAt || history.createdAt > previousCreatedAt) {
          previousCreatedAt = history.createdAt;
        }
      }
    }
  } else {
    // For non-grouped alerts, get the single history
    const previous = previousMap.get(alert.id);
    previousCreatedAt = previous?.createdAt;
  }

  const rawStartTime = previousCreatedAt
    ? previousCreatedAt.getTime()
    : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins).getTime();
  const clampedStartTime =
    scheduleStartAt == null
      ? rawStartTime
      : Math.max(rawStartTime, scheduleStartAt.getTime());

  return calcAlertDateRange(
    clampedStartTime,
    nowInMinsRoundDown.getTime(),
    windowSizeInMins,
  );
};

const getChartConfigFromAlert = (
  details: AlertDetails,
  connection: string,
  dateRange: [Date, Date],
  windowSizeInMins: number,
): ChartConfigWithOptDateRange | undefined => {
  const { alert } = details;
  if (details.taskType === AlertTaskType.SAVED_SEARCH) {
    const { source } = details;
    const savedSearch = details.savedSearch;
    return {
      connection,
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
      filters: savedSearch.filters?.map(f => ({ ...f })),
      groupBy: alert.groupBy,
      implicitColumnExpression:
        source.kind === SourceKind.Log || source.kind === SourceKind.Trace
          ? source.implicitColumnExpression
          : undefined,
      ...pickSampleWeightExpressionProps(source),
      timestampValueExpression: source.timestampValueExpression,
    };
  } else if (details.taskType === AlertTaskType.TILE) {
    const tile = details.tile;

    // Raw SQL tiles: build a RawSqlChartConfig
    if (isRawSqlSavedChartConfig(tile.config)) {
      if (displayTypeSupportsRawSqlAlerts(tile.config.displayType)) {
        return {
          ...pick(tile.config, [
            'configType',
            'sqlTemplate',
            'displayType',
            'source',
          ]),
          connection,
          dateRange,
          // Only time-series charts use interval bucketing
          ...(isTimeSeriesDisplayType(tile.config.displayType) && {
            granularity: `${windowSizeInMins} minute`,
          }),
          // Include source metadata for macro expansion ($__sourceTable)
          ...(details.source && {
            from: details.source.from,
            metricTables:
              details.source.kind === SourceKind.Metric
                ? details.source.metricTables
                : undefined,
          }),
        };
      }
      return undefined;
    }

    const { source } = details;
    if (!source) {
      logger.error(
        { alertId: alert.id },
        'Source not found for builder tile alert',
      );
      return undefined;
    }

    // Doesn't work for metric alerts yet
    if (
      tile.config.displayType === DisplayType.Line ||
      tile.config.displayType === DisplayType.StackedBar ||
      tile.config.displayType === DisplayType.Number
    ) {
      // Tile alerts can use Log, Trace, or Metric sources.
      // implicitColumnExpression exists on Log and Trace sources;
      // metricTables exists on Metric sources.
      const implicitColumnExpression =
        source.kind === SourceKind.Log || source.kind === SourceKind.Trace
          ? source.implicitColumnExpression
          : undefined;
      const sampleWeightExpression = getSampleWeightExpression(source);
      const metricTables =
        source.kind === SourceKind.Metric ? source.metricTables : undefined;
      return {
        connection,
        dateRange,
        dateRangeStartInclusive: true,
        dateRangeEndInclusive: false,
        displayType: tile.config.displayType,
        from: source.from,
        granularity: `${windowSizeInMins} minute`,
        groupBy: tile.config.groupBy,
        implicitColumnExpression,
        sampleWeightExpression,
        metricTables,
        select: tile.config.select,
        timestampValueExpression: source.timestampValueExpression,
        where: tile.config.where,
        whereLanguage: tile.config.whereLanguage,
        seriesReturnType: tile.config.seriesReturnType,
      };
    }
  }

  logger.error(
    {
      alertId: alert.id,
    },
    `Unsupported alert source: ${alert.source}`,
  );

  return undefined;
};

type ResponseMetadata =
  | {
      type: 'time_series';
      timestampColumnName: string;
      valueColumnNames: Set<string>;
    }
  | {
      type: 'single_value';
      valueColumnNames: Set<string>;
    };

const getResponseMetadata = (
  chartConfig: ChartConfigWithOptDateRange,
  data: ResponseJSON<Record<string, string | number>>,
): ResponseMetadata | undefined => {
  if (!data?.meta) {
    return undefined;
  }

  // attach JS type
  const meta =
    data.meta?.map(m => ({
      ...m,
      jsType: clickhouse.convertCHDataTypeToJSType(m.type),
    })) ?? [];

  const valueColumnNames = new Set(
    meta
      .filter(m => m.jsType === clickhouse.JSDataType.Number)
      .map(m => m.name),
  );

  if (valueColumnNames.size === 0) {
    logger.error({ meta }, 'Failed to find value column');
    return undefined;
  }

  // Raw SQL charts with Number display type don't use interval parameters, so they cannot be treated as timeseries.
  // Number-type Builder Charts are rendered as time-series, to maintain legacy behavior for existing alerts.
  if (
    isRawSqlChartConfig(chartConfig) &&
    chartConfig.displayType === DisplayType.Number
  ) {
    return { type: 'single_value', valueColumnNames };
  } else {
    const timestampColumnName = meta.find(
      m => m.jsType === clickhouse.JSDataType.Date,
    )?.name;

    if (timestampColumnName == null) {
      logger.error({ meta }, 'Failed to find timestamp column');
      return undefined;
    }

    return { type: 'time_series', timestampColumnName, valueColumnNames };
  }
};

/**
 * Parses the following from the given alert query result:
 * - `value`: the numeric value to compare against the alert threshold, taken
 *   from the last column in the result which is included in valueColumnNames
 * - `extraFields`: an array of strings representing the names and values of
 *   each column in the result which is neither the timestampColumnName nor a
 *   valueColumnName, formatted as "columnName:value".
 */
const parseAlertData = (
  data: Record<string, string | number>,
  meta: ResponseMetadata,
) => {
  let value: number | null = null;
  const extraFields: string[] = [];

  for (const [k, v] of Object.entries(data)) {
    if (meta.valueColumnNames.has(k)) {
      value = isString(v) ? parseInt(v) : v;
    } else if (meta.type !== 'time_series' || k !== meta.timestampColumnName) {
      extraFields.push(`${k}:${v}`);
    }
  }

  return { value, extraFields };
};

export const processAlert = async (
  now: Date,
  details: AlertDetails,
  clickhouseClient: ClickhouseClient,
  connectionId: string,
  alertProvider: AlertProvider,
  teamWebhooksById: Map<string, IWebhook>,
) => {
  const { alert, previousMap } = details;
  const source = 'source' in details ? details.source : undefined;
  try {
    const windowSizeInMins = ms(alert.interval) / 60000;
    const scheduleStartAt = normalizeScheduleStartAt({
      alertId: alert.id,
      scheduleStartAt: alert.scheduleStartAt,
    });
    if (scheduleStartAt != null && now < scheduleStartAt) {
      logger.info(
        {
          alertId: alert.id,
          now,
          scheduleStartAt,
        },
        'Skipped alert check because scheduleStartAt is in the future',
      );
      return;
    }

    const scheduleOffsetMinutes = normalizeScheduleOffsetMinutes({
      alertId: alert.id,
      scheduleOffsetMinutes: alert.scheduleOffsetMinutes,
      windowSizeInMins,
    });
    if (scheduleStartAt != null && scheduleOffsetMinutes > 0) {
      logger.info(
        {
          alertId: alert.id,
          scheduleStartAt,
          scheduleOffsetMinutes,
        },
        'scheduleStartAt is set; scheduleOffsetMinutes is ignored for window alignment',
      );
    }
    const nowInMinsRoundDown = getScheduledWindowStart(
      now,
      windowSizeInMins,
      scheduleOffsetMinutes,
      scheduleStartAt,
    );
    const hasGroupBy = alertHasGroupBy(details);

    // Check if we should skip this alert check based on last evaluation time
    if (shouldSkipAlertCheck(details, hasGroupBy, nowInMinsRoundDown)) {
      logger.info(
        {
          windowSizeInMins,
          nowInMinsRoundDown,
          now,
          alertId: alert.id,
          hasGroupBy,
          scheduleOffsetMinutes,
          scheduleStartAt,
        },
        `Skipped to check alert since the time diff is still less than 1 window size`,
      );
      return;
    }

    const dateRange = getAlertEvaluationDateRange(
      details,
      hasGroupBy,
      nowInMinsRoundDown,
      windowSizeInMins,
      scheduleStartAt,
    );
    if (dateRange[0].getTime() >= dateRange[1].getTime()) {
      logger.info(
        {
          alertId: alert.id,
          dateRange,
          nowInMinsRoundDown,
          scheduleStartAt,
        },
        'Skipped alert check because the anchored window has not fully elapsed yet',
      );
      return;
    }

    const chartConfig = getChartConfigFromAlert(
      details,
      connectionId,
      dateRange,
      windowSizeInMins,
    );

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

    // For saved search alerts, the WHERE clause may reference aliased columns
    // from the saved search's select expression (e.g. `toString(Body) AS body`).
    // The alert query itself uses count(*), not the saved search's select,
    // so we render the saved search's select separately to discover aliases
    // and inject them as WITH clauses into the alert query.
    if (details.taskType === AlertTaskType.SAVED_SEARCH) {
      if (!isBuilderChartConfig(chartConfig)) {
        logger.error({
          chartConfig,
          message:
            'Found non-builder chart config for saved search alert, cannot compute WITH clauses',
        });
        throw new Error('Expected builder chart config for saved search alert');
      }
      try {
        const withClauses = await computeAliasWithClauses(
          details.savedSearch,
          details.source,
          metadata,
        );
        if (withClauses) {
          chartConfig.with = withClauses;
        }
      } catch (e) {
        logger.warn(
          { error: serializeError(e), alertId: alert.id },
          'Failed to compute alias WITH clauses for alert check',
        );
      }
    }

    // Optimize chart config with materialized views, if available.
    // materializedViews exists on Log and Trace sources.
    const mvSource =
      source?.kind === SourceKind.Log || source?.kind === SourceKind.Trace
        ? source
        : undefined;
    const optimizedChartConfig =
      isBuilderChartConfig(chartConfig) && mvSource?.materializedViews?.length
        ? await tryOptimizeConfigWithMaterializedView(
            chartConfig,
            metadata,
            clickhouseClient,
            undefined,
            mvSource,
          )
        : chartConfig;

    // Readonly = 2 means the query is readonly but can still specify query settings.
    // This is done only for Raw SQL configs because it carries a minor risk of conflict with
    // existing settings (which may have readonly = 1) and is not required for builder
    // chart configs, which are always rendered as select statements.
    const clickHouseSettings = isRawSqlChartConfig(optimizedChartConfig)
      ? { readonly: '2' }
      : {};

    // Query for alert data
    const checksData = await clickhouseClient.queryChartConfig({
      config: optimizedChartConfig,
      metadata,
      opts: { clickhouse_settings: clickHouseSettings },
      querySettings: source?.querySettings,
    });

    logger.info(
      {
        alertId: alert.id,
        chartConfig,
        optimizedChartConfig,
        checksData,
        checkStartTime: dateRange[0],
        checkEndTime: dateRange[1],
      },
      `Received alert metric [${alert.source} source]`,
    );

    // Track state per group (or one history if no groupBy)
    const histories = new Map<string, IAlertHistory>();

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

    // Helper to send a notification, catching and logging any errors.
    const trySendNotification = async ({
      group,
      totalCount,
      state,
      startTime = nowInMinsRoundDown,
    }: {
      state: AlertState;
      totalCount: number;
      group: string;
      startTime?: Date;
    }) => {
      logger.info(
        { alertId: alert.id, group, totalCount },
        state === AlertState.ALERT
          ? `Triggering ${alert.channel.type} alarm!`
          : `Alert resolved for group "${group}", triggering ${alert.channel.type} notification`,
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
          startTime,
          endTime: fns.addMinutes(startTime, windowSizeInMins),
          group,
          isGroupedAlert: hasGroupBy,
          metadata,
          savedSearch: (details as any).savedSearch,
          source,
          state,
          totalCount,
          windowSizeInMins,
          teamWebhooksById,
        });
      } catch (e) {
        logger.error(
          { alertId: alert.id, group, error: serializeError(e) },
          'Failed to fire channel event',
        );
      }
    };

    const sendNotificationIfResolved = async (
      previousHistory: AggregatedAlertHistory | undefined,
      currentHistory: IAlertHistory,
      groupKey: string,
    ) => {
      if (
        previousHistory?.state === AlertState.ALERT &&
        currentHistory.state === AlertState.OK
      ) {
        const lastValue =
          currentHistory.lastValues[currentHistory.lastValues.length - 1];
        await trySendNotification({
          state: AlertState.OK,
          group: groupKey,
          totalCount: lastValue?.count || 0,
          startTime: lastValue?.startTime || nowInMinsRoundDown,
        });
      }
    };

    const meta = getResponseMetadata(chartConfig, checksData);
    if (!meta) {
      logger.error({ alertId: alert.id }, 'Failed to get response metadata');
      return;
    }

    // single_value type (Raw SQL Number charts) returns a single value with no
    // timestamp column, and are assumed to not have groups.
    if (meta.type === 'single_value') {
      // Use the date range end as the alert timestamp.
      const alertTimestamp = dateRange[1];
      const history = getOrCreateHistory('');

      // The value is taken from the last numeric column of the first row.
      // The value defaults to 0.
      const value =
        checksData.data.length > 0
          ? (parseAlertData(checksData.data[0], meta).value ?? 0)
          : 0;

      history.lastValues.push({ count: value, startTime: alertTimestamp });
      if (doesExceedThreshold(alert.thresholdType, alert.threshold, value)) {
        history.state = AlertState.ALERT;
        history.counts += 1;
        await trySendNotification({
          state: AlertState.ALERT,
          group: '',
          totalCount: value,
          startTime: alertTimestamp,
        });
      }

      // Auto-resolve
      const previous = previousMap.get(computeHistoryMapKey(alert.id, ''));
      await sendNotificationIfResolved(previous, history, '');

      const historyRecords = Array.from(histories.values());
      await alertProvider.updateAlertState(alert.id, historyRecords);
      return;
    }

    // ── Time-series path (Line/StackedBar charts) ──
    const expectedBuckets = timeBucketByGranularity(
      dateRange[0],
      dateRange[1],
      `${windowSizeInMins} minute`,
    );

    // Group data by time bucket (grouped alerts may have multiple entries per time bucket)
    const checkDataByBucket = new Map<
      number,
      Record<string, string | number>[]
    >();

    for (const checkData of checksData.data) {
      const bucketStart = new Date(checkData[meta.timestampColumnName]);
      if (!checkDataByBucket.has(bucketStart.getTime())) {
        checkDataByBucket.set(bucketStart.getTime(), []);
      }

      checkDataByBucket.get(bucketStart.getTime())!.push(checkData);
    }

    for (const bucketStart of expectedBuckets) {
      const dataForBucket = checkDataByBucket.get(bucketStart.getTime());

      // Handle case where no data is available for this bucket
      const bucketHasData = dataForBucket && dataForBucket.length > 0;
      if (!bucketHasData) {
        logger.info(
          { alertId: alert.id, bucketStart },
          'No data returned from ClickHouse for time bucket',
        );

        const zeroValueIsAlert = doesExceedThreshold(
          alert.thresholdType,
          alert.threshold,
          0,
        );

        const hasAlertsInPreviousMap = previousMap
          .values()
          .some(history => history.state === AlertState.ALERT);

        if (zeroValueIsAlert) {
          const history = getOrCreateHistory('');
          history.lastValues.push({ count: 0, startTime: bucketStart });
          history.state = AlertState.ALERT;
          history.counts += 1;
          await trySendNotification({
            state: AlertState.ALERT,
            group: '',
            totalCount: 0,
            startTime: bucketStart,
          });
        } else if (!hasGroupBy || !hasAlertsInPreviousMap) {
          // For grouped alerts, if there are alerts in the previous map,
          // we will handle creating a history as part of auto-resolve later
          const history = getOrCreateHistory('');
          history.lastValues.push({ count: 0, startTime: bucketStart });
        }

        continue;
      }

      // We have at least one data point for this bucket
      for (const checkData of dataForBucket) {
        const { value, extraFields } = parseAlertData(checkData, meta);

        // TODO: we might want to fix the null value from the upstream (check if this is still needed)
        // this happens when the ratio is 0/0
        if (value == null) {
          continue;
        }

        // Group key is the joined extraFields for group-by alerts, or empty string for non-grouped
        const groupKey = hasGroupBy ? extraFields.join(', ') : '';
        const history = getOrCreateHistory(groupKey);

        if (doesExceedThreshold(alert.thresholdType, alert.threshold, value)) {
          history.state = AlertState.ALERT;
          await trySendNotification({
            state: AlertState.ALERT,
            group: groupKey,
            totalCount: value,
            startTime: bucketStart,
          });

          history.counts += 1;
        } else {
          // TODO: if the alert was previously alerting (different bucket), should we set state to OK (plus auto-resolve)?
        }
        history.lastValues.push({ count: value, startTime: bucketStart });
      }
    }

    // Handle missing groups: If current check found no data, check if any previously alerting groups need to be resolved
    // For group-by alerts, check if any previously alerting groups are missing from current data
    if (hasGroupBy && previousMap && previousMap.size > 0) {
      for (const [previousKey, previousHistory] of previousMap.entries()) {
        const groupKey = extractGroupKeyFromMapKey(previousKey, alert.id);

        // If this group was previously ALERT but is missing from current data and would be resolved by a 0 value,
        // create an OK history for the group
        if (
          previousHistory.state === AlertState.ALERT &&
          !histories.has(groupKey) &&
          !doesExceedThreshold(alert.thresholdType, alert.threshold, 0)
        ) {
          logger.info(
            {
              alertId: alert.id,
              group: groupKey,
            },
            `Group "${groupKey}" is missing from current data but was previously alerting - creating OK history`,
          );
          const history = getOrCreateHistory(groupKey);
          history.lastValues.push({ count: 0, startTime: expectedBuckets[0] });
        }
      }
    }

    // If no histories exist at all (no current data and no previous alerting groups), create a default OK history
    if (histories.size === 0) {
      getOrCreateHistory('');
    }

    // Check for auto-resolve: for each group, check if it transitioned from ALERT to OK
    for (const [groupKey, history] of histories.entries()) {
      const previousKey = computeHistoryMapKey(alert.id, groupKey);
      const groupPrevious = previousMap.get(previousKey);
      await sendNotificationIfResolved(groupPrevious, history, groupKey);
    }

    // Save all history records and update alert state
    const historyRecords = Array.from(histories.values());
    await alertProvider.updateAlertState(alert.id, historyRecords);
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
 * Uses per-alert queries instead of batched $in to leverage the compound index
 * {alert: 1, group: 1, createdAt: -1} for index-backed sorting. With a single
 * alert value, the index delivers results already sorted by {group, createdAt desc},
 * so the $sort is a no-op and $group + $first can short-circuit per group.
 *
 * @param alertIds The list of alert IDs to query the latest history for.
 * @param now The current date and time. AlertHistory documents that have a createdAt > now are ignored.
 * @returns A map from Alert IDs (or Alert ID + group) to their most recent AlertHistory.
 *  For non-grouped alerts, the key is just the alert ID.
 *  For grouped alerts, the key is "alertId||group" to track per-group state.
 */
export const getPreviousAlertHistories = async (
  alertIds: string[],
  now: Date,
) => {
  const lookbackDate = new Date(now.getTime() - ms('7d'));

  // Use a concurrency-limited queue to avoid overwhelming the connection pool
  // when there are many alerts (e.g., 200+ alert IDs).
  const queue = new PQueue({ concurrency: ALERT_HISTORY_QUERY_CONCURRENCY });

  const results = await Promise.all(
    alertIds.map(alertId =>
      queue.add(async () => {
        const id = new mongoose.Types.ObjectId(alertId);
        return AlertHistory.aggregate<AggregatedAlertHistory>([
          {
            $match: {
              alert: id,
              createdAt: { $lte: now, $gte: lookbackDate },
            },
          },
          // With a single alert value, the compound index {alert: 1, group: 1, createdAt: -1}
          // delivers results already in this sort order — this is an index-backed no-op sort.
          {
            $sort: { alert: 1, group: 1, createdAt: -1 },
          },
          // Group by {alert, group}, taking the first (latest) document's fields.
          // Using $first on individual fields instead of $first: '$$ROOT' allows
          // DocumentDB to avoid fetching full documents when not needed.
          {
            $group: {
              _id: {
                alert: '$alert',
                group: '$group',
              },
              createdAt: { $first: '$createdAt' },
              state: { $first: '$state' },
            },
          },
          {
            $project: {
              _id: '$_id.alert',
              createdAt: 1,
              state: 1,
              group: '$_id.group',
            },
          },
        ]);
      }),
    ),
  );

  // Create a map with composite keys for grouped alerts (alertId||group) or simple keys for non-grouped alerts
  return new Map<string, AggregatedAlertHistory>(
    results
      .flat()
      .filter((h): h is AggregatedAlertHistory => h !== undefined)
      .map(history => {
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
          this.task_queue.add(async () =>
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
      this.task_queue.add(async () =>
        this.processAlertTask(task, teamWebhooksById),
      );
    }
    logger.debug(
      {
        args: this.args,
      },
      'finished scheduling alert tasks on the task_queue',
    );

    // make sure to await here to drain the work queue and allow
    // functions to execute. if not, execute will terminate without
    // executing all checks
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
