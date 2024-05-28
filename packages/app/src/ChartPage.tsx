import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {
  parseAsJson,
  parseAsStringEnum,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs';

import { Granularity } from './ChartUtils';
import EditTileForm from './EditTileForm';
import { withAppNav } from './layout';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import type { Chart, ChartSeries } from './types';

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

const DEFAULT_SERIES: ChartSeries[] = [
  {
    table: 'logs',
    type: 'time',
    aggFn: 'count',
    field: undefined,
    where: '',
    groupBy: [],
  },
];

const getLegacySeriesQueryParam = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const series = params.getAll('series');
    return series?.flatMap(series =>
      series != null ? [JSON.parse(series)] : [],
    );
  } catch (e) {
    console.warn('Failed to parse legacy query param', e);
  }
};

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

function GraphPage() {
  const [_granularity, _setGranularity] = useQueryState(
    'granularity',
    parseAsStringEnum<Granularity>(Object.values(Granularity)),
  );

  const granularity = _granularity ?? undefined;
  const setGranularity = useCallback(
    (value: Granularity | undefined) => {
      _setGranularity(value || null);
    },
    [_setGranularity],
  );

  const [seriesReturnType, setSeriesReturnType] = useQueryState(
    'seriesReturnType',
    parseAsStringLiteral(['ratio', 'column'] as const),
  );

  const [chartSeries, setChartSeries] = useQueryState(
    'chartSeries',
    parseAsJson<ChartSeries[]>().withDefault(DEFAULT_SERIES),
  );

  // Support for legacy query param
  const [_, setLegacySeries] = useQueryState('series', {
    shallow: true,
  });

  useEffect(() => {
    const legacySeries = getLegacySeriesQueryParam();
    if (legacySeries?.length) {
      // Clear the legacy query param
      setChartSeries(legacySeries);
      setLegacySeries(null);
    }
  }, []);

  const editedChart = useMemo<Chart>(() => {
    return {
      id: 'chart-explorer',
      name: 'My New Chart',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      series: chartSeries.length ? chartSeries : DEFAULT_SERIES,
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

// TODO: Restore when we fix hydratrion errors
// export default GraphPage;

const GraphPageDynamic = dynamic(async () => GraphPage, { ssr: false });
// @ts-ignore
GraphPageDynamic.getLayout = withAppNav;

export default GraphPageDynamic;
