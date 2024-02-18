import { memo } from 'react';

import api from './api';
import { Granularity } from './ChartUtils';
import type { AggFn, ChartSeries, NumberFormat } from './types';
import { formatNumber } from './utils';

const HDXNumberChart = memo(
  ({
    config: {
      series,
      table,
      aggFn,
      field,
      where,
      dateRange,
      numberFormat,
      granularity,
    },
    onSettled,
  }: {
    config: {
      series: ChartSeries[];
      table: string;
      aggFn: AggFn;
      field: string;
      where: string;
      dateRange: [Date, Date];
      numberFormat?: NumberFormat;
      granularity?: Granularity;
    };
    onSettled?: () => void;
  }) => {
    const isLogsChartApi = table === 'logs' && series.length === 1;

    const { data, isError, isLoading } = isLogsChartApi
      ? api.useLogsChart(
          {
            aggFn,
            endDate: dateRange[1] ?? new Date(),
            field,
            granularity: undefined,
            groupBy: '',
            q: where,
            startDate: dateRange[0] ?? new Date(),
          },
          {
            onSettled,
          },
        )
      : api.useMultiSeriesChart(
          {
            series,
            startDate: dateRange[0] ?? new Date(),
            endDate: dateRange[1] ?? new Date(),
            granularity,
            seriesReturnType: series.length > 1 ? 'ratio' : 'column',
          },
          {
            onSettled,
          },
        );
    const sortedData = data?.data?.sort(
      (a: any, b: any) => b?.ts_bucket - a?.ts_bucket,
    );

    const number = formatNumber(
      isLogsChartApi
        ? sortedData?.[0]?.data
        : sortedData?.[0]?.['series_0.data'],
      numberFormat,
    );

    return isLoading ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : data?.data?.length === 0 ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        No data found within time range.
      </div>
    ) : (
      <div className="d-flex align-items-center justify-content-center fs-2 h-100">
        {number}
      </div>
    );
  },
);

export default HDXNumberChart;
