import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import produce from 'immer';
import { Button } from 'react-bootstrap';
import { ErrorBoundary } from 'react-error-boundary';
import { toast } from 'react-toastify';
import type { QueryParamConfig } from 'serialize-query-params';
import { decodeArray, encodeArray } from 'serialize-query-params';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';

import AppNav from './AppNav';
import { ChartSeriesForm } from './ChartUtils';
import DSSelect from './DSSelect';
import HDXLineChart from './HDXLineChart';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import SearchTimeRangePicker, {
  parseTimeRangeInput,
} from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import type { AggFn, ChartSeries, SourceTable } from './types';
import { useQueryParam as useHDXQueryParam } from './useQueryParam';

export const ChartSeriesParam: QueryParamConfig<ChartSeries[] | undefined> = {
  encode: (
    chartSeries: ChartSeries[] | undefined,
  ): (string | null)[] | null | undefined => {
    return encodeArray(chartSeries?.map(chart => JSON.stringify(chart)));
  },
  decode: (
    input: string | (string | null)[] | null | undefined,
  ): ChartSeries[] | undefined => {
    // TODO: Validation
    return decodeArray(input)?.flatMap(series =>
      series != null ? [JSON.parse(series)] : [],
    );
  },
};

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false);
export default function GraphPage() {
  const labelWidth = 350;

  const [chartSeries, setChartSeries] = useHDXQueryParam<ChartSeries[]>(
    'series',
    [
      {
        table: 'logs',
        type: 'time',
        aggFn: 'count',
        field: undefined,
        where: '',
        groupBy: [],
      },
    ],
    {
      queryParamConfig: ChartSeriesParam,
    },
  );

  const setAggFn = (index: number, fn: AggFn) => {
    setChartSeries(
      produce(chartSeries, series => {
        const s = series?.[index];
        if (s != null && s.type === 'time') {
          s.aggFn = fn;
        }
      }),
    );
  };
  const setField = (index: number, field: string | undefined) => {
    setChartSeries(
      produce(chartSeries, series => {
        const s = series?.[index];
        if (s != null && s.type === 'time') {
          s.field = field;
        }
      }),
    );
  };
  const setFieldAndAggFn = (
    index: number,
    field: string | undefined,
    fn: AggFn,
  ) => {
    setChartSeries(
      produce(chartSeries, series => {
        const s = series?.[index];
        if (s != null && s.type === 'time') {
          s.field = field;
          s.aggFn = fn;
        }
      }),
    );
  };
  const setWhere = (index: number, where: string) => {
    setChartSeries(
      produce(chartSeries, series => {
        const s = series?.[index];
        if (s != null && s.type === 'time') {
          s.where = where;
        }
      }),
    );
  };
  const setGroupBy = (index: number, groupBy: string | undefined) => {
    setChartSeries(
      produce(chartSeries, series => {
        const s = series?.[index];
        if (s != null && s.type === 'time') {
          s.groupBy = groupBy != null ? [groupBy] : [];
        }
      }),
    );
  };

  const [granularity, setGranularity] = useQueryParam<
    | '30 second'
    | '1 minute'
    | '5 minute'
    | '10 minute'
    | '30 minute'
    | '1 hour'
    | '2 hour'
    | '12 hour'
    | '1 day'
    | '7 day'
    | undefined
  >('granularity', withDefault(StringParam, '5 minute') as any, {
    updateType: 'pushIn',
  });
  const [chartConfig, setChartConfig] = useState<any>();

  const { displayedTimeInputValue, setDisplayedTimeInputValue, onSearch } =
    useTimeQuery({
      isUTC: false,
      defaultValue: 'Past 1h',
      defaultTimeRange: [
        defaultTimeRange?.[0]?.getTime() ?? -1,
        defaultTimeRange?.[1]?.getTime() ?? -1,
      ],
    });

  const onRunQuery = useCallback(() => {
    onSearch(displayedTimeInputValue);
    const dateRange = parseTimeRangeInput(displayedTimeInputValue);

    if (
      dateRange[0] != null &&
      dateRange[1] != null &&
      chartSeries[0].type === 'time'
    ) {
      setChartConfig({
        // TODO: Support multiple series
        table: chartSeries[0].table ?? 'logs',
        aggFn: chartSeries[0].aggFn,
        field: chartSeries[0].field,
        where: chartSeries[0].where,
        groupBy: chartSeries[0].groupBy[0],
        granularity: granularity ?? '5 minute', // TODO: Auto granularity
        dateRange,
      });
    } else {
      toast.error('Invalid time range');
    }
  }, [chartSeries, displayedTimeInputValue, granularity, onSearch]);

  return (
    <div className="LogViewerPage d-flex" style={{ height: '100vh' }}>
      <Head>
        <title>Chart Explorer - HyperDX</title>
      </Head>
      <AppNav />
      <div
        style={{ background: '#16171D', height: '100%' }}
        className="d-flex flex-column flex-grow-1"
      >
        <form className="bg-body p-3" onSubmit={e => e.preventDefault()}>
          <div className="fs-5 mb-3 fw-500">Create New Chart</div>
          {chartSeries.map((series, index) => {
            if (series.type !== 'time') {
              return null;
            }
            return (
              <ChartSeriesForm
                key={index}
                table={series.table}
                aggFn={series.aggFn}
                where={series.where}
                groupBy={series.groupBy[0]}
                field={series.field}
                setFieldAndAggFn={(field, aggFn) =>
                  setFieldAndAggFn(index, field, aggFn)
                }
                setTableAndAggFn={(table, aggFn) => {
                  setChartSeries(
                    produce(chartSeries, series => {
                      const s = series?.[index];
                      if (s != null && s.type === 'time') {
                        s.table = table;
                        s.aggFn = aggFn;
                      }
                    }),
                  );
                }}
                setWhere={where => setWhere(index, where)}
                setAggFn={fn => setAggFn(index, fn)}
                setGroupBy={groupBy => setGroupBy(index, groupBy)}
                setField={field => setField(index, field)}
              />
            );
          })}
          <div className="d-flex mt-3 align-items-center">
            <div
              style={{ width: labelWidth }}
              className="text-muted fw-500 ps-2"
            >
              Time Range
            </div>
            <div className="ms-3 flex-grow-1" style={{ maxWidth: 360 }}>
              <SearchTimeRangePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={range => {
                  setDisplayedTimeInputValue(range);
                }}
              />
            </div>
            <div className="flex-grow-1 ms-3" style={{ maxWidth: 360 }}>
              <DSSelect
                options={[
                  {
                    value: '30 second' as const,
                    label: '30 Seconds Granularity',
                  },
                  {
                    value: '1 minute' as const,
                    label: '1 Minute Granularity',
                  },
                  {
                    value: '5 minute' as const,
                    label: '5 Minutes Granularity',
                  },
                  {
                    value: '10 minute' as const,
                    label: '10 Minutes Granularity',
                  },
                  {
                    value: '30 minute' as const,
                    label: '30 Minutes Granularity',
                  },
                  {
                    value: '1 hour' as const,
                    label: '1 Hour Granularity',
                  },
                  {
                    value: '12 hour' as const,
                    label: '12 Hours Granularity',
                  },
                  {
                    value: '1 day' as const,
                    label: '1 Day Granularity',
                  },
                  {
                    value: '7 day' as const,
                    label: '7 Day Granularity',
                  },
                ]}
                onChange={setGranularity}
                value={granularity}
              />
            </div>
          </div>
          <div className="ms-2 mt-3">
            <Button
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              onClick={onRunQuery}
              type="submit"
            >
              <i className="bi bi-graph-up me-2"></i>
              Run Query
            </Button>
          </div>
        </form>
        <div
          className="w-100 mt-4 flex-grow-1"
          style={{ height: 400, minWidth: 0 }}
        >
          <ErrorBoundary
            onError={console.error}
            fallback={
              <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                An error occurred while rendering the chart.
              </div>
            }
          >
            {chartConfig != null && <HDXLineChart config={chartConfig} />}
          </ErrorBoundary>
        </div>
        {chartConfig != null && chartConfig.table === 'logs' && (
          <div className="ps-2 mt-2 border-top border-dark">
            <div className="my-3 fs-7 fw-bold">Sample Matched Events</div>
            <div style={{ height: 150 }} className="bg-hdx-dark">
              <LogTableWithSidePanel
                config={{
                  ...chartConfig,
                  where: `${chartConfig.where} ${
                    chartConfig.aggFn != 'count' && chartConfig.field != ''
                      ? `${chartConfig.field}:*`
                      : ''
                  } ${
                    chartConfig.groupBy != '' && chartConfig.groupBy != null
                      ? `${chartConfig.groupBy}:*`
                      : ''
                  }`,
                }}
                isLive={false}
                isUTC={false}
                setIsUTC={() => {}}
                onPropertySearchClick={() => {}}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
