import { memo } from 'react';

import api from './api';
import { AggFn } from './ChartUtils';
import { NumberFormat } from './types';
import { formatNumber } from './utils';

const HDXNumberChart = memo(
  ({
    config: { table, aggFn, field, where, dateRange, numberFormat },
    onSettled,
  }: {
    config: {
      table: string;
      aggFn: AggFn;
      field: string;
      where: string;
      dateRange: [Date, Date];
      numberFormat?: NumberFormat;
    };
    onSettled?: () => void;
  }) => {
    const { data, isError, isLoading } =
      table === 'logs'
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
        : api.useMetricsChart(
            {
              aggFn,
              endDate: dateRange[1] ?? new Date(),
              granularity: undefined,
              name: field,
              q: where,
              startDate: dateRange[0] ?? new Date(),
              groupBy: '',
            },
            {
              onSettled,
            },
          );

    const number = formatNumber(data?.data?.[0]?.data, numberFormat);

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
