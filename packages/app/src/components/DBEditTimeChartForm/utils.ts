import z from 'zod';
import {
  isBuilderChartConfig,
  isRawSqlChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartAlertBaseSchema,
  ChartConfigWithDateRange,
  ChartConfigWithOptTimestamp,
  DisplayType,
  Filter,
  SavedChartConfig,
  SelectList,
  SourceKind,
  TSource,
  validateAlertScheduleOffsetMinutes,
} from '@hyperdx/common-utils/dist/types';

import {
  convertToNumberChartConfig,
  convertToPieChartConfig,
  convertToTableChartConfig,
  convertToTimeChartConfig,
} from '@/ChartUtils';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { getFirstTimestampValueExpression } from '@/source';
import {
  extendDateRangeToInterval,
  intervalToGranularity,
} from '@/utils/alerts';

export const isQueryReady = (
  queriedConfig: ChartConfigWithDateRange | undefined,
) => {
  if (!queriedConfig) return false;
  if (isRawSqlChartConfig(queriedConfig)) {
    return !!(queriedConfig.sqlTemplate && queriedConfig.connection);
  }
  return (
    ((queriedConfig.select?.length ?? 0) > 0 ||
      typeof queriedConfig.select === 'string') &&
    queriedConfig.from?.databaseName &&
    // tableName is empty for metric sources
    (queriedConfig.from?.tableName || queriedConfig.metricTables) &&
    queriedConfig.timestampValueExpression
  );
};

export const zSavedChartConfig = z
  .object({
    // TODO: Chart
    alert: ChartAlertBaseSchema.superRefine(
      validateAlertScheduleOffsetMinutes,
    ).optional(),
  })
  .passthrough();

// similar to seriesToSearchQuery from v1
export function seriesToFilters(select: SelectList): Filter[] {
  if (typeof select === 'string') {
    return [];
  }

  const filters: Filter[] = select
    .map(({ aggCondition, aggConditionLanguage }) => {
      if (aggConditionLanguage != null && aggCondition != null) {
        return {
          type: aggConditionLanguage,
          condition: aggCondition,
        };
      } else {
        return null;
      }
    })
    .filter(f => f != null);

  return filters;
}

export function displayTypeToActiveTab(displayType: DisplayType): string {
  switch (displayType) {
    case DisplayType.Search:
      return 'search';
    case DisplayType.Heatmap:
      return 'heatmap';
    case DisplayType.Markdown:
      return 'markdown';
    case DisplayType.Table:
      return 'table';
    case DisplayType.Pie:
      return 'pie';
    case DisplayType.Number:
      return 'number';
    default:
      return 'time';
  }
}

export const TABS_WITH_GENERATED_SQL = new Set([
  'table',
  'time',
  'heatmap',
  'number',
  'pie',
]);

export function computeDbTimeChartConfig(
  queriedConfig: ChartConfigWithDateRange | undefined,
  alert: ChartEditorFormState['alert'],
): ChartConfigWithDateRange | undefined {
  if (!queriedConfig) {
    return undefined;
  }

  return {
    ...queriedConfig,
    granularity: alert
      ? intervalToGranularity(alert.interval)
      : queriedConfig.granularity,
    dateRange: alert
      ? extendDateRangeToInterval(queriedConfig.dateRange, alert.interval)
      : queriedConfig.dateRange,
  };
}

export function buildSampleEventsConfig(
  queriedConfig: ChartConfigWithDateRange | undefined,
  tableSource: TSource | undefined,
  dateRange: [Date, Date],
  queryReady: boolean,
) {
  if (
    tableSource == null ||
    queriedConfig == null ||
    !isBuilderChartConfig(queriedConfig) ||
    !queryReady
  ) {
    return null;
  }

  return {
    ...queriedConfig,
    orderBy: [
      {
        ordering: 'DESC' as const,
        valueExpression: getFirstTimestampValueExpression(
          tableSource.timestampValueExpression,
        ),
      },
    ],
    dateRange,
    timestampValueExpression: tableSource.timestampValueExpression,
    connection: tableSource.connection,
    from: tableSource.from,
    limit: { limit: 200 },
    select:
      ((tableSource.kind === SourceKind.Log ||
        tableSource.kind === SourceKind.Trace) &&
        tableSource.defaultTableSelectExpression) ||
      '',
    filters: seriesToFilters(queriedConfig.select),
    filtersLogicalOperator: 'OR' as const,
    groupBy: undefined,
    granularity: undefined,
    having: undefined,
  };
}

type BuildChartConfigForExplanationsParams = {
  queriedConfig?: ChartConfigWithDateRange;
  queriedSourceId?: string;
  tableSource?: TSource;
  chartConfig: SavedChartConfig;
  dateRange: [Date, Date];
  activeTab: string;
  dbTimeChartConfig?: ChartConfigWithDateRange;
};

export function buildChartConfigForExplanations({
  queriedConfig,
  queriedSourceId,
  tableSource,
  chartConfig,
  dateRange,
  activeTab,
  dbTimeChartConfig,
}: BuildChartConfigForExplanationsParams):
  | ChartConfigWithOptTimestamp
  | undefined {
  if (queriedConfig && isRawSqlChartConfig(queriedConfig))
    return { ...queriedConfig, dateRange };

  if (chartConfig && isRawSqlSavedChartConfig(chartConfig))
    return { ...chartConfig, dateRange };

  const userHasSubmittedQuery = !!queriedConfig;
  const queriedSourceMatchesSelectedSource =
    queriedSourceId === tableSource?.id;
  const urlParamsSourceMatchesSelectedSource =
    chartConfig.source === tableSource?.id;

  const effectiveQueriedConfig =
    activeTab === 'time' ? dbTimeChartConfig : queriedConfig;

  const config =
    userHasSubmittedQuery && queriedSourceMatchesSelectedSource
      ? effectiveQueriedConfig
      : chartConfig && urlParamsSourceMatchesSelectedSource && tableSource
        ? {
            ...chartConfig,
            dateRange,
            timestampValueExpression: tableSource.timestampValueExpression,
            from: tableSource.from,
            connection: tableSource.connection,
          }
        : undefined;

  if (!config || isRawSqlChartConfig(config)) {
    return undefined;
  }

  // Apply the transformations that child components will apply,
  // so that the MV optimization explanation and generated SQL preview
  // are accurate.
  if (activeTab === 'time') {
    return convertToTimeChartConfig(config);
  } else if (activeTab === 'number') {
    return convertToNumberChartConfig(config);
  } else if (activeTab === 'table') {
    return convertToTableChartConfig(config);
  } else if (activeTab === 'pie') {
    return convertToPieChartConfig(config);
  }

  return config;
}
