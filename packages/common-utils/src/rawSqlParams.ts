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

export enum RawSqlQueryParam {
  startDateMilliseconds = 'startDateMilliseconds',
  endDateMilliseconds = 'endDateMilliseconds',
  intervalSeconds = 'intervalSeconds',
  intervalMilliseconds = 'intervalMilliseconds',
}

export const QUERY_PARAMS: Record<RawSqlQueryParam, QueryParamDefinition> = {
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
  [DisplayType.Pie]: [
    QUERY_PARAMS.startDateMilliseconds,
    QUERY_PARAMS.endDateMilliseconds,
  ],
  [DisplayType.Number]: [
    QUERY_PARAMS.startDateMilliseconds,
    QUERY_PARAMS.endDateMilliseconds,
  ],
  [DisplayType.Search]: [],
  [DisplayType.Heatmap]: [],
  [DisplayType.Markdown]: [],
};

const TIME_CHART_EXAMPLE_SQL = `SELECT
  toStartOfInterval(TimestampTime, INTERVAL {intervalSeconds:Int64} second) AS ts, -- (Timestamp column)
  ServiceName,                                                                     -- (Group name column)
  count()                                                                          -- (Series value column)
FROM $__sourceTable
WHERE TimestampTime >= fromUnixTimestamp64Milli ({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli ({endDateMilliseconds:Int64})
  AND $__filters
GROUP BY ServiceName, ts`;

export const DATE_RANGE_WHERE_EXAMPLE_SQL = `WHERE TimestampTime >= fromUnixTimestamp64Milli ({startDateMilliseconds:Int64})
  AND TimestampTime <= fromUnixTimestamp64Milli ({endDateMilliseconds:Int64})
  AND $__filters`;

export const QUERY_PARAM_EXAMPLES: Record<DisplayType, string> = {
  [DisplayType.Line]: TIME_CHART_EXAMPLE_SQL,
  [DisplayType.StackedBar]: TIME_CHART_EXAMPLE_SQL,
  [DisplayType.Table]: DATE_RANGE_WHERE_EXAMPLE_SQL,
  [DisplayType.Pie]: DATE_RANGE_WHERE_EXAMPLE_SQL,
  [DisplayType.Number]: DATE_RANGE_WHERE_EXAMPLE_SQL,
  [DisplayType.Search]: '',
  [DisplayType.Heatmap]: '',
  [DisplayType.Markdown]: '',
};

export function renderQueryParam(name: keyof typeof QUERY_PARAMS): string {
  // eslint-disable-next-line security/detect-object-injection
  return `{${QUERY_PARAMS[name].name}:${QUERY_PARAMS[name].type}}`;
}
