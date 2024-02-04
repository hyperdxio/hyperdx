import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { queryTypes, useQueryStates } from 'next-usequerystate';
import { decodeArray, encodeArray } from 'serialize-query-params';

import { Granularity } from './ChartUtils';
import EditTileForm from './EditTileForm';
import { withAppNav } from './layout';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import type { Chart, ChartSeries } from './types';

const ChartSeriesParam = {
  serialize: (chartSeries: ChartSeries[] | undefined): string => {
    return encodeArray(
      chartSeries?.map(chart => JSON.stringify(chart)),
    ) as unknown as string;
  },
  parse: (query: string): ChartSeries[] => {
    console.log('q', query);

    if (query == null || query == '') {
      console.log('hi!');

      return [
        {
          table: 'logs',
          type: 'time',
          aggFn: 'count',
          field: undefined,
          where: '',
          groupBy: [],
        },
      ];
    }
    // TODO: Validation
    return decodeArray(query)?.flatMap(series =>
      series != null ? [JSON.parse(series)] : [],
    );
  },
  defaultValue: [
    {
      table: 'logs',
      type: 'time',
      aggFn: 'count',
      field: undefined,
      where: '',
      groupBy: [],
    },
  ],
};

function getDashboard(chart: Chart) {
  return {
    _id: '',
    name: 'My New Dashboard',
    charts: [chart],
    alerts: [],
    tags: [],
    query: '',
  };
}

function getDashboardHref({
  chart,
  dateRange,
  granularity,
  timeQuery,
}: {
  chart: Chart;
  dateRange: [Date, Date];
  timeQuery: string;
  granularity: Granularity | undefined;
}) {
  const dashboard = getDashboard(chart);

  const params = new URLSearchParams({
    config: JSON.stringify(dashboard),
    tq: timeQuery,
    ...(dateRange[0] != null && dateRange[1] != null
      ? { from: dateRange[0].toISOString(), to: dateRange[1].toISOString() }
      : {}),
    ...(granularity ? { granularity } : {}),
  });

  return `/dashboards?${params.toString()}`;
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];
export default function GraphPage() {
  const [queryState, setQueryState] = useQueryStates({
    // series: queryTypes.json<ChartSeries[]>().withDefault([
    //   {
    //     table: 'logs',
    //     type: 'time',
    //     aggFn: 'count',
    //     field: undefined,
    //     where: '',
    //     groupBy: [],
    //   },
    // ]),
    series: ChartSeriesParam,
    granularity: queryTypes.stringEnum<Granularity>([
      ...Object.values(Granularity),
    ]),
    seriesReturnType: queryTypes.stringEnum<'ratio' | 'column'>([
      'ratio',
      'column',
    ]),
  });

  const setGranularity = useCallback(
    (granularity: Granularity | undefined) => {
      setQueryState({ granularity: granularity ?? null });
    },
    [setQueryState],
  );

  const chartSeries = queryState.series;
  console.log(chartSeries, queryState);
  const granularity =
    queryState.granularity == null ? undefined : queryState.granularity;
  const seriesReturnType =
    queryState.seriesReturnType == null
      ? undefined
      : queryState.seriesReturnType;

  const editedChart = useMemo<Chart>(() => {
    return {
      id: 'chart-explorer',
      name: 'My New Chart',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      series: chartSeries,
      seriesReturnType: seriesReturnType ?? 'column',
    };
  }, [chartSeries, seriesReturnType]);

  const setEditedChart = useCallback(
    (chart: Chart) => {
      setQueryState({
        series: chart.series,
        seriesReturnType: chart.seriesReturnType,
      });
    },
    [setQueryState],
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
            createDashboardHref={getDashboardHref({
              timeQuery: displayedTimeInputValue,
              chart: editedChart,
              dateRange: searchedTimeRange,
              granularity,
            })}
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
