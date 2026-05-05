import { SearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  BuilderChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Flex, Group } from '@mantine/core';

import { DBTimeChart } from '@/components/DBTimeChart';
import PatternTable from '@/components/PatternTable';
import { getEventBody } from '@/source';

import { SearchNumRows } from './SearchNumRows';
import { SearchResultsCountGroup } from './SearchResultsCountGroup';
import { QUERY_KEY_PREFIX } from './utils';

import searchPageStyles from '@/../styles/SearchPage.module.scss';

type SearchPatternViewProps = {
  chartConfig: SearchChartConfig;
  histogramTimeChartConfig: BuilderChartConfigWithDateRange;
  searchedSource: TSource | undefined;
  searchedTimeRange: [Date, Date];
  sourceId: string | undefined;
  isReady: boolean;
  hasQueryError: boolean;
  isFilterSidebarCollapsed: boolean;
  onExpandFilters: () => void;
  onTimeRangeSelect: (start: Date, end: Date) => void;
};

export function SearchPatternView({
  chartConfig,
  histogramTimeChartConfig,
  searchedSource,
  searchedTimeRange,
  sourceId,
  isReady,
  hasQueryError,
  isFilterSidebarCollapsed,
  onExpandFilters,
  onTimeRangeSelect,
}: SearchPatternViewProps) {
  return (
    <Flex direction="column" w="100%" gap="0px" mih="0" miw={0}>
      <Box className={searchPageStyles.searchStatsContainer}>
        <Group justify="space-between" align="center" style={{ width: '100%' }}>
          <SearchResultsCountGroup
            isFilterSidebarCollapsed={isFilterSidebarCollapsed}
            onExpandFilters={onExpandFilters}
            histogramTimeChartConfig={histogramTimeChartConfig}
          />
          <SearchNumRows
            config={{
              ...chartConfig,
              dateRange: searchedTimeRange,
            }}
            enabled={isReady}
          />
        </Group>
      </Box>
      {!hasQueryError && (
        <Box className={searchPageStyles.timeChartContainer} mih="0">
          <DBTimeChart
            sourceId={sourceId}
            showLegend={false}
            config={histogramTimeChartConfig}
            enabled={isReady}
            showDisplaySwitcher={false}
            showMVOptimizationIndicator={false}
            showDateRangeIndicator={false}
            queryKeyPrefix={QUERY_KEY_PREFIX}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </Box>
      )}
      <Box flex="1" mih="0" px="sm">
        <PatternTable
          source={searchedSource}
          config={{
            ...chartConfig,
            dateRange: searchedTimeRange,
          }}
          bodyValueExpression={
            searchedSource
              ? (getEventBody(searchedSource) ?? '')
              : (chartConfig.implicitColumnExpression ?? '')
          }
          totalCountConfig={histogramTimeChartConfig}
          totalCountQueryKeyPrefix={QUERY_KEY_PREFIX}
        />
      </Box>
    </Flex>
  );
}
