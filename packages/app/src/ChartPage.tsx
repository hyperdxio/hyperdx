import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import type { QueryParamConfig } from 'serialize-query-params';
import { decodeArray, encodeArray } from 'serialize-query-params';

import { Granularity, isGranularity } from './ChartUtils';
import EditTileForm from './EditTileForm';
import { withAppNav } from './layout';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import type { Chart, ChartSeries } from './types';
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
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];
export default function GraphPage() {
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

  const [granularity, setGranularity] = useHDXQueryParam<
    Granularity | undefined
  >('granularity', undefined, {
    queryParamConfig: {
      encode: (value: Granularity | undefined) => value ?? undefined,
      decode: (input: string | (string | null)[] | null | undefined) =>
        typeof input === 'string' && isGranularity(input) ? input : undefined,
    },
  });

  const [seriesReturnType, setSeriesReturnType] = useHDXQueryParam<
    'ratio' | 'column' | undefined
  >('seriesReturnType', undefined, {
    queryParamConfig: {
      encode: (value: 'ratio' | 'column' | undefined) => value ?? undefined,
      decode: (input: string | (string | null)[] | null | undefined) =>
        input === 'ratio' ? 'ratio' : 'column',
    },
  });

  const editedChart = useMemo<Chart>(() => {
    return {
      id: 'chart-explorer',
      name: 'My New Chart',
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      series: chartSeries,
      seriesReturnType: seriesReturnType ?? 'column',
    };
  }, [chartSeries, seriesReturnType]);

  const setEditedChart = useCallback(
    (chart: Chart) => {
      setChartSeries(chart.series);
      setSeriesReturnType(chart.seriesReturnType);
    },
    [setChartSeries, setSeriesReturnType],
  );

  const { isReady, searchedTimeRange, displayedTimeInputValue, onSearch } =
    useNewTimeQuery({
      isUTC: false,
      initialDisplayValue: 'Past 1h',
      initialTimeRange: defaultTimeRange,
    });

  const [input, setInput] = useState<string>(displayedTimeInputValue);
  useEffect(() => {
    setInput(displayedTimeInputValue);
  }, [displayedTimeInputValue]);

  return (
    <div className="LogViewerPage">
      <Head>
        <title>Chart Explorer - HyperDX</title>
      </Head>
      <div
        style={{ minHeight: '100vh' }}
        className="d-flex flex-column bg-hdx-dark p-3"
      >
        {isReady ? (
          <EditTileForm
            chart={editedChart}
            isLocalDashboard
            dateRange={searchedTimeRange}
            editedChart={editedChart}
            setEditedChart={setEditedChart}
            displayedTimeInputValue={input}
            setDisplayedTimeInputValue={setInput}
            onTimeRangeSearch={onSearch}
            granularity={granularity}
            setGranularity={setGranularity}
            hideSearch
            hideMarkdown
          />
        ) : (
          'Loading...'
        )}
      </div>
    </div>
  );
}

GraphPage.getLayout = withAppNav;
