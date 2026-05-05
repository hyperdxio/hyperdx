import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { SearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Flex, Group } from '@mantine/core';
import { SortingState } from '@tanstack/react-table';

import type { RowSidePanelContextProps } from '@/components/DBRowSidePanel';
import DBSqlRowTableWithSideBar from '@/components/DBSqlRowTableWithSidebar';
import { DBTimeChart } from '@/components/DBTimeChart';
import { Suggestion } from '@/hooks/useSqlSuggestions';

import { ResumeLiveTailButton } from './ResumeLiveTailButton';
import { SearchErrorDisplay } from './SearchErrorDisplay';
import { SearchNumRows } from './SearchNumRows';
import { SearchResultsCountGroup } from './SearchResultsCountGroup';
import { QUERY_KEY_PREFIX } from './utils';

import searchPageStyles from '@/../styles/SearchPage.module.scss';

type SearchResultsViewProps = {
  chartConfig: SearchChartConfig | null;
  histogramTimeChartConfig: BuilderChartConfigWithDateRange | undefined;
  dbSqlRowTableConfig: BuilderChartConfigWithDateRange | undefined;
  searchedTimeRange: [Date, Date];
  sourceId: string | undefined;
  isReady: boolean;
  isLive: boolean;
  isFilterSidebarCollapsed: boolean;
  hasQueryError: boolean;
  queryError: Error | ClickHouseQueryError | null;
  whereSuggestions: Suggestion[] | undefined;
  shouldShowLiveModeHint: boolean;
  denoiseResults: boolean;
  collapseAllRows: boolean;
  initialSortBy: SortingState;
  rowTableContext: RowSidePanelContextProps;
  onExpandFilters: () => void;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  onResumeLiveTail: () => void;
  onTableScroll: (scrollTop: number) => void;
  onSidebarOpen: () => void;
  onExpandedRowsChange: (hasExpandedRows: boolean) => void;
  onTableError: (error: Error | ClickHouseQueryError) => void;
  onSortingChange: (sortState: SortingState | null) => void;
  onAcceptWhereSuggestion: (corrected: string) => void;
};

export function SearchResultsView({
  chartConfig,
  histogramTimeChartConfig,
  dbSqlRowTableConfig,
  searchedTimeRange,
  sourceId,
  isReady,
  isLive,
  isFilterSidebarCollapsed,
  hasQueryError,
  queryError,
  whereSuggestions,
  shouldShowLiveModeHint,
  denoiseResults,
  collapseAllRows,
  initialSortBy,
  rowTableContext,
  onExpandFilters,
  onTimeRangeSelect,
  onResumeLiveTail,
  onTableScroll,
  onSidebarOpen,
  onExpandedRowsChange,
  onTableError,
  onSortingChange,
  onAcceptWhereSuggestion,
}: SearchResultsViewProps) {
  return (
    <Flex direction="column" mih="0" miw={0}>
      {chartConfig && histogramTimeChartConfig && (
        <>
          <Box className={searchPageStyles.searchStatsContainer}>
            <Group
              justify="space-between"
              align="center"
              style={{ width: '100%' }}
            >
              <SearchResultsCountGroup
                isFilterSidebarCollapsed={isFilterSidebarCollapsed}
                onExpandFilters={onExpandFilters}
                histogramTimeChartConfig={histogramTimeChartConfig}
                enableParallelQueries
              />
              <Group gap="sm" align="center">
                {shouldShowLiveModeHint && denoiseResults != true && (
                  <ResumeLiveTailButton
                    handleResumeLiveTail={onResumeLiveTail}
                  />
                )}
                <SearchNumRows
                  config={{
                    ...chartConfig,
                    dateRange: searchedTimeRange,
                  }}
                  enabled={isReady}
                />
              </Group>
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
                enableParallelQueries
              />
            </Box>
          )}
        </>
      )}
      {hasQueryError && queryError && chartConfig ? (
        <SearchErrorDisplay
          chartConfig={chartConfig}
          queryError={queryError}
          whereSuggestions={whereSuggestions}
          onAcceptSuggestion={onAcceptWhereSuggestion}
        />
      ) : (
        <Box flex="1" mih="0" px="sm">
          {chartConfig && sourceId && dbSqlRowTableConfig && (
            <DBSqlRowTableWithSideBar
              context={rowTableContext}
              config={dbSqlRowTableConfig}
              sourceId={sourceId}
              onSidebarOpen={onSidebarOpen}
              onExpandedRowsChange={onExpandedRowsChange}
              enabled={isReady}
              isLive={isLive}
              queryKeyPrefix={QUERY_KEY_PREFIX}
              onScroll={onTableScroll}
              onError={onTableError}
              denoiseResults={denoiseResults}
              collapseAllRows={collapseAllRows}
              onSortingChange={onSortingChange}
              initialSortBy={initialSortBy}
              enableSmallFirstWindow
            />
          )}
        </Box>
      )}
    </Flex>
  );
}
