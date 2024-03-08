import { memo } from 'react';

import api from './api';
import type { ChartSeries, NumberFormat } from './types';
import { formatNumber } from './utils';

const HDXNumberChart = memo(
  ({
    config: { series, dateRange, numberFormat },
    onSettled,
  }: {
    config: {
      series: ChartSeries[];
      dateRange: [Date, Date];
      numberFormat?: NumberFormat;
    };
    onSettled?: () => void;
  }) => {
    const { data, isError, isLoading } = api.useMultiSeriesChart(
      {
        series,
        startDate: dateRange[0],
        endDate: dateRange[1],
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
      sortedData?.[0]?.['series_0.data'],
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
