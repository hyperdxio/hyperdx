import z from 'zod';
import {
  TableConnection,
  TableConnectionChoice,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
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
  convertToCategoricalChartConfig,
  convertToNumberChartConfig,
  convertToTableChartConfig,
  convertToTimeChartConfig,
} from '@/ChartUtils';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { getFirstTimestampValueExpression } from '@/source';
import { getMetricTableName } from '@/utils';
import {
  extendDateRangeToInterval,
  intervalToGranularity,
} from '@/utils/alerts';

export const isQueryReady = (
  queriedConfig: ChartConfigWithDateRange | undefined,
) => {
  if (!queriedConfig) return false;
  if (isPromqlChartConfig(queriedConfig)) {
    return !!(queriedConfig.promqlExpression && queriedConfig.connection);
  }
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
      if (
        aggConditionLanguage != null &&
        aggConditionLanguage !== 'promql' &&
        aggCondition != null
      ) {
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
    case DisplayType.Markdown:
      return 'markdown';
    case DisplayType.Table:
      return 'table';
    case DisplayType.Pie:
      return 'pie';
    case DisplayType.Bar:
      return 'bar';
    case DisplayType.Number:
      return 'number';
    case DisplayType.Heatmap:
      return 'heatmap';
    case DisplayType.EventPatterns:
      return 'event_patterns';
    default:
      return 'time';
  }
}

export const TABS_WITH_GENERATED_SQL = new Set([
  'table',
  'time',
  'number',
  'pie',
  'bar',
  'heatmap',
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

  if (!config || !isBuilderChartConfig(config)) {
    return undefined;
  }

  // Apply the transformations that child components will apply,
  // so that the MV optimization explanation and generated SQL preview
  // are accurate.  Heatmap is special-cased: it actually runs as two
  // sequential queries (bounds + bucketed counts) that depend on each
  // other at runtime, so the SQL preview transforms `config` itself into
  // both queries on render and the MV indicator is suppressed for this
  // tab.  Returning `config` unchanged is intentional.
  const builderConfig = config as BuilderChartConfigWithDateRange;

  if (activeTab === 'time') {
    return convertToTimeChartConfig(builderConfig);
  } else if (activeTab === 'number') {
    return convertToNumberChartConfig(builderConfig);
  } else if (activeTab === 'table') {
    return convertToTableChartConfig(builderConfig);
  } else if (activeTab === 'pie' || activeTab === 'bar') {
    return convertToCategoricalChartConfig(builderConfig);
  } else if (activeTab === 'heatmap') {
    return config;
  }

  return config;
}

/**
 * Picks the table connection(s) that drive attribute autocomplete for the
 * chart-level Group By.
 *
 * Metric sources have no single `from.tableName` (they fan out to per-type
 * metric tables), so we build one connection per series' metric table + name
 * (deduped) and ask the editor to offer only fields present in ALL of them
 * (`intersectFields`). A ratio can mix metric types (e.g. gauge / sum) whose
 * tables have different native columns — a union would suggest a column that
 * only exists in one series and make the other series' query fail, so the Group
 * By must be restricted to fields valid for every series.
 *
 * Non-metric sources (and metric sources with no resolvable series) fall back
 * to the source's single `tableConnection`.
 */
export function buildGroupByConnectionProps({
  tableSource,
  series,
  tableConnection,
}: {
  tableSource: TSource | undefined;
  series: { metricType?: string; metricName?: string }[] | undefined;
  tableConnection: TableConnection;
}): TableConnectionChoice & { intersectFields?: boolean } {
  if (tableSource?.kind !== SourceKind.Metric || !Array.isArray(series)) {
    return { tableConnection };
  }

  const seen = new Set<string>();
  const connections: TableConnection[] = [];
  for (const s of series) {
    if (!s?.metricType || !s?.metricName) continue;
    const metricTable = getMetricTableName(tableSource, s.metricType);
    if (!metricTable) continue;
    const key = `${metricTable}::${s.metricName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connections.push({
      databaseName: tableSource.from.databaseName,
      tableName: metricTable,
      connectionId: tableSource.connection,
      metricName: s.metricName,
    });
  }

  return connections.length > 0
    ? { tableConnections: connections, intersectFields: true }
    : { tableConnection };
}
