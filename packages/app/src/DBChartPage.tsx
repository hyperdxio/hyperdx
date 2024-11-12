import { useCallback } from 'react';
import dynamic from 'next/dynamic';
import { parseAsJson, parseAsStringEnum, useQueryState } from 'nuqs';
import { Box } from '@mantine/core';

import { DEFAULT_CHART_CONFIG, Granularity } from '@/ChartUtils';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import { DisplayType } from '@/DisplayType';
import { withAppNav } from '@/layout';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { SavedChartConfig } from './renderChartConfig';
import { useSources } from './source';

// Autocomplete can focus on column/map keys

// Sampled field discovery and full field discovery

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

function DBChartExplorerPage() {
  const {
    searchedTimeRange,
    displayedTimeInputValue,
    setDisplayedTimeInputValue,
    onSearch,
    onTimeRangeSelect,
  } = useNewTimeQuery({
    initialDisplayValue: 'Past 1h',
    initialTimeRange: defaultTimeRange,
    // showRelativeInterval: isLive,
  });

  const { data: sources } = useSources();

  const [chartConfig, setChartConfig] = useQueryState(
    'config',
    parseAsJson<SavedChartConfig>().withDefault({
      ...DEFAULT_CHART_CONFIG,
      source: sources?.[0]?.id ?? '',
    }),
  );

  return (
    <Box p="sm" className="bg-hdx-dark">
      <EditTimeChartForm
        chartConfig={chartConfig}
        setChartConfig={config => {
          setChartConfig(config);
        }}
        dateRange={searchedTimeRange}
        setDisplayedTimeInputValue={setDisplayedTimeInputValue}
        displayedTimeInputValue={displayedTimeInputValue}
        onTimeRangeSearch={onSearch}
        onTimeRangeSelect={onTimeRangeSelect}
      />
    </Box>
  );
}

const DBChartExplorerPageDynamic = dynamic(async () => DBChartExplorerPage, {
  ssr: false,
});

// @ts-ignore
DBChartExplorerPageDynamic.getLayout = withAppNav;

export default DBChartExplorerPageDynamic;
