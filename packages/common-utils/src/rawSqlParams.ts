import { ChSql } from './clickhouse';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
} from './core/utils';
import { DateRange, DisplayType, RawSqlChartConfig } from './types';

type QueryParamDefinition = {
  name: string;
  type: string;
  description: string;
  get: (config: RawSqlChartConfig & Partial<DateRange>) => any;
};

const getIntervalSeconds = (config: RawSqlChartConfig & Partial<DateRange>) => {
  const granularity = config.granularity ?? 'auto';

  const effectiveGranularity =
    granularity === 'auto' && config.dateRange
      ? convertDateRangeToGranularityString(config.dateRange)
      : granularity;

  return convertGranularityToSeconds(effectiveGranularity);
};

export const QUERY_PARAMS: Record<string, QueryParamDefinition> = {
  startDateMilliseconds: {
    name: 'startDateMilliseconds',
    type: 'Int64',
    description:
      'start of the dashboard date range, in milliseconds since epoch',
    get: (config: RawSqlChartConfig & Partial<DateRange>) =>
      config.dateRange ? config.dateRange[0].getTime() : undefined,
  },
  endDateMilliseconds: {
    name: 'endDateMilliseconds',
    type: 'Int64',
    description: 'end of the dashboard date range, in milliseconds since epoch',
    get: (config: RawSqlChartConfig & Partial<DateRange>) =>
      config.dateRange ? config.dateRange[1].getTime() : undefined,
  },
  intervalSeconds: {
    name: 'intervalSeconds',
    type: 'Int64',
    description: 'time bucket size in seconds',
    get: getIntervalSeconds,
  },
  intervalMilliseconds: {
    name: 'intervalMilliseconds',
    type: 'Int64',
    description: 'time bucket size in milliseconds',
    get: (config: RawSqlChartConfig & Partial<DateRange>) =>
      getIntervalSeconds(config) * 1000,
  },
};

export const QUERY_PARAMS_BY_DISPLAY_TYPE: Record<
  DisplayType,
  QueryParamDefinition[]
> = {
  [DisplayType.Line]: [
    QUERY_PARAMS.startDateMilliseconds,
    QUERY_PARAMS.endDateMilliseconds,
    QUERY_PARAMS.intervalSeconds,
    QUERY_PARAMS.intervalMilliseconds,
  ],
  [DisplayType.StackedBar]: [
    QUERY_PARAMS.startDateMilliseconds,
    QUERY_PARAMS.endDateMilliseconds,
    QUERY_PARAMS.intervalSeconds,
    QUERY_PARAMS.intervalMilliseconds,
  ],
  [DisplayType.Table]: [
    QUERY_PARAMS.startDateMilliseconds,
    QUERY_PARAMS.endDateMilliseconds,
  ],
  [DisplayType.Pie]: [],
  [DisplayType.Number]: [],
  [DisplayType.Search]: [],
  [DisplayType.Heatmap]: [],
  [DisplayType.Markdown]: [],
};

const TIME_CHART_EXAMPLE_SQL = `SELECT
  toStartOfInterval(TimestampTime, INTERVAL {intervalSeconds:Int64} second) AS ts, -- (Timestamp column)
  ServiceName,                                                                     -- (Group name column)
  count()                                                                          -- (Series value column)
FROM otel_logs
WHERE TimestampTime >= fromUnixTimestamp64Milli ({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli ({endDateMilliseconds:Int64})
GROUP BY ServiceName, ts`;

export const QUERY_PARAM_EXAMPLES: Record<DisplayType, string> = {
  [DisplayType.Line]: TIME_CHART_EXAMPLE_SQL,
  [DisplayType.StackedBar]: TIME_CHART_EXAMPLE_SQL,
  [DisplayType.Table]: `WHERE Timestamp >= fromUnixTimestamp64Milli ({startDateMilliseconds:Int64})
  AND Timestamp <= fromUnixTimestamp64Milli ({endDateMilliseconds:Int64})`,
  [DisplayType.Pie]: '',
  [DisplayType.Number]: '',
  [DisplayType.Search]: '',
  [DisplayType.Heatmap]: '',
  [DisplayType.Markdown]: '',
};

export function renderRawSqlChartConfig(
  chartConfig: RawSqlChartConfig & Partial<DateRange>,
): ChSql {
  const displayType = chartConfig.displayType ?? DisplayType.Table;

  // eslint-disable-next-line security/detect-object-injection
  const queryParams = QUERY_PARAMS_BY_DISPLAY_TYPE[displayType];

  return {
    sql: chartConfig.sqlTemplate ?? '',
    params: Object.fromEntries(
      queryParams.map(param => [param.name, param.get(chartConfig)]),
    ),
  };
}
