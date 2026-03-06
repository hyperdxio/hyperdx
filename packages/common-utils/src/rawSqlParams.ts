import { ChSql } from './clickhouse';
import { DateRange, DisplayType, RawSqlChartConfig } from './types';

type QueryParamDefinition = {
  name: string;
  type: string;
  description: string;
  get: (config: RawSqlChartConfig & Partial<DateRange>) => any;
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
};

export const QUERY_PARAMS_BY_DISPLAY_TYPE: Record<
  DisplayType,
  QueryParamDefinition[]
> = {
  [DisplayType.Line]: [],
  [DisplayType.StackedBar]: [],
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
