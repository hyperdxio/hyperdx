import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { SearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { IconStack2 } from '@tabler/icons-react';
import { SortingState } from '@tanstack/react-table';

import type { RowSidePanelContextProps } from '@/components/DBRowSidePanel';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import EmptyState from '@/components/EmptyState';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { DBSearchHeatmapChart } from '@/components/Search/DBSearchHeatmapChart';
import { Suggestion } from '@/hooks/useSqlSuggestions';
import { FilterStateHook } from '@/searchFilters';

import { SearchPatternView } from './SearchPatternView';
import { SearchResultsView } from './SearchResultsView';

import searchPageStyles from '@/../styles/SearchPage.module.scss';

type AnalysisMode = 'results' | 'delta' | 'pattern';

type SearchResultsAreaProps = {
  queryReady: boolean;
  analysisMode: AnalysisMode;
  setAnalysisMode: (mode: AnalysisMode) => void;
  isFilterSidebarCollapsed: boolean;
  setIsFilterSidebarCollapsed: (value: boolean) => void;
  denoiseResults: boolean;
  setDenoiseResults: (value: boolean) => void;
  isLive: boolean;
  filtersChartConfig: BuilderChartConfigWithDateRange;
  chartConfig: SearchChartConfig | null;
  histogramTimeChartConfig: BuilderChartConfigWithDateRange | undefined;
  dbSqlRowTableConfig: BuilderChartConfigWithDateRange | undefined;
  inputSourceId: string | undefined;
  searchedSource: TSource | undefined;
  searchedSourceId: string | undefined;
  searchedTimeRange: [Date, Date];
  isReady: boolean;
  hasQueryError: boolean;
  queryError: Error | ClickHouseQueryError | null;
  whereSuggestions: Suggestion[] | undefined;
  shouldShowLiveModeHint: boolean;
  collapseAllRows: boolean;
  initialSortBy: SortingState;
  rowTableContext: RowSidePanelContextProps;
  aliasWith: ReturnType<typeof aliasMapToWithClauses>;
  searchFilters: FilterStateHook;
  displayedColumns: string[];
  onColumnToggle: (column: string) => void;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  onResumeLiveTail: () => void;
  onTableScroll: (scrollTop: number) => void;
  onSidebarOpen: () => void;
  onExpandedRowsChange: (hasExpandedRows: boolean) => void;
  onTableError: (error: Error | ClickHouseQueryError) => void;
  onSortingChange: (sortState: SortingState | null) => void;
  onAcceptWhereSuggestion: (corrected: string) => void;
};

export function SearchResultsArea(props: SearchResultsAreaProps) {
  const {
    queryReady,
    analysisMode,
    setAnalysisMode,
    isFilterSidebarCollapsed,
    setIsFilterSidebarCollapsed,
    denoiseResults,
    setDenoiseResults,
    isLive,
    filtersChartConfig,
    chartConfig,
    histogramTimeChartConfig,
    dbSqlRowTableConfig,
    inputSourceId,
    searchedSource,
    searchedSourceId,
    searchedTimeRange,
    isReady,
    hasQueryError,
    queryError,
    whereSuggestions,
    shouldShowLiveModeHint,
    collapseAllRows,
    initialSortBy,
    rowTableContext,
    aliasWith,
    searchFilters,
    displayedColumns,
    onColumnToggle,
    onTimeRangeSelect,
    onResumeLiveTail,
    onTableScroll,
    onSidebarOpen,
    onExpandedRowsChange,
    onTableError,
    onSortingChange,
    onAcceptWhereSuggestion,
  } = props;

  if (!queryReady) {
    return (
      <EmptyState
        h="100%"
        icon={<IconStack2 size={32} />}
        title="No data to display"
        description="Select a source and click the play button to query data."
      />
    );
  }

  return (
    <div
      className={searchPageStyles.searchPageContainer}
      style={{
        minHeight: 0,
        height: '100%',
      }}
    >
      {!isFilterSidebarCollapsed && (
        <ErrorBoundary message="Unable to render search filters">
          <DBSearchPageFilters
            denoiseResults={denoiseResults}
            setDenoiseResults={setDenoiseResults}
            isLive={isLive}
            analysisMode={analysisMode}
            setAnalysisMode={setAnalysisMode}
            chartConfig={filtersChartConfig}
            sourceId={inputSourceId}
            showDelta={
              !!(searchedSource && isTraceSource(searchedSource)
                ? searchedSource.durationExpression
                : undefined)
            }
            onColumnToggle={onColumnToggle}
            displayedColumns={displayedColumns}
            onCollapse={() => setIsFilterSidebarCollapsed(true)}
            {...searchFilters}
          />
        </ErrorBoundary>
      )}
      {analysisMode === 'pattern' &&
        chartConfig != null &&
        histogramTimeChartConfig != null && (
          <SearchPatternView
            chartConfig={chartConfig}
            histogramTimeChartConfig={histogramTimeChartConfig}
            searchedSource={searchedSource}
            searchedTimeRange={searchedTimeRange}
            sourceId={searchedSourceId}
            isReady={isReady}
            hasQueryError={hasQueryError}
            isFilterSidebarCollapsed={isFilterSidebarCollapsed}
            onExpandFilters={() => setIsFilterSidebarCollapsed(false)}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        )}
      {analysisMode === 'delta' &&
        searchedSource != null &&
        isTraceSource(searchedSource) &&
        chartConfig != null && (
          <DBSearchHeatmapChart
            chartConfig={{
              ...chartConfig,
              dateRange: searchedTimeRange,
              with: aliasWith,
            }}
            isReady={isReady}
            source={searchedSource}
            onAddFilter={searchFilters.setFilterValue}
          />
        )}
      {analysisMode === 'results' && (
        <SearchResultsView
          chartConfig={chartConfig}
          histogramTimeChartConfig={histogramTimeChartConfig}
          dbSqlRowTableConfig={dbSqlRowTableConfig}
          searchedTimeRange={searchedTimeRange}
          sourceId={searchedSourceId}
          isReady={isReady}
          isLive={isLive}
          isFilterSidebarCollapsed={isFilterSidebarCollapsed}
          hasQueryError={hasQueryError}
          queryError={queryError}
          whereSuggestions={whereSuggestions}
          shouldShowLiveModeHint={shouldShowLiveModeHint}
          denoiseResults={denoiseResults}
          collapseAllRows={collapseAllRows}
          initialSortBy={initialSortBy}
          rowTableContext={rowTableContext}
          onExpandFilters={() => setIsFilterSidebarCollapsed(false)}
          onTimeRangeSelect={onTimeRangeSelect}
          onResumeLiveTail={onResumeLiveTail}
          onTableScroll={onTableScroll}
          onSidebarOpen={onSidebarOpen}
          onExpandedRowsChange={onExpandedRowsChange}
          onTableError={onTableError}
          onSortingChange={onSortingChange}
          onAcceptWhereSuggestion={onAcceptWhereSuggestion}
        />
      )}
    </div>
  );
}
