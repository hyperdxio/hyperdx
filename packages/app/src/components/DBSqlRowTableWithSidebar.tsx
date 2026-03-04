import { useCallback, useState } from 'react';
import { useQueryState } from 'nuqs';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { SortingState } from '@tanstack/react-table';

import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import { useSource } from '@/source';
import TabBar from '@/TabBar';
import { useLocalStorage } from '@/utils';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import { useNestedPanelState } from './ContextSidePanel';
import { RowDataPanel } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import DBRowSidePanel, {
  RowSidePanelContext,
  RowSidePanelContextProps,
} from './DBRowSidePanel';
import { BreadcrumbEntry } from './DBRowSidePanelHeader';
import { DBRowTableVariant, DBSqlRowTable } from './DBRowTable';

interface Props {
  sourceId: string;
  config: ChartConfigWithDateRange;
  onError?: (error: Error | ClickHouseQueryError) => void;
  onScroll?: (scrollTop: number) => void;
  onSidebarOpen?: (rowId: string) => void;
  onExpandedRowsChange?: (hasExpandedRows: boolean) => void;
  onPropertyAddClick?: (keyPath: string, value: string) => void;
  context?: RowSidePanelContextProps;
  enabled?: boolean;
  isLive?: boolean;
  queryKeyPrefix?: string;
  denoiseResults?: boolean;
  collapseAllRows?: boolean;
  isNestedPanel?: boolean;
  breadcrumbPath?: BreadcrumbEntry[];
  onSortingChange?: (v: SortingState | null) => void;
  initialSortBy?: SortingState;
  variant?: DBRowTableVariant;
}

export default function DBSqlRowTableWithSideBar({
  sourceId,
  config,
  onError,
  onScroll,
  context,
  onExpandedRowsChange,
  denoiseResults,
  collapseAllRows,
  isLive,
  enabled,
  isNestedPanel,
  breadcrumbPath,
  onSidebarOpen,
  onSortingChange,
  initialSortBy,
  variant,
}: Props) {
  const { data: sourceData } = useSource({ id: sourceId });
  const [rowId, setRowId] = useQueryState('rowWhere', parseAsStringEncoded);
  const [rowSource, setRowSource] = useQueryState('rowSource');
  const [aliasWith, setAliasWith] = useState<WithClause[]>([]);
  const { setContextRowId, setContextRowSource } = useNestedPanelState();

  const onOpenSidebar = useCallback(
    (rowWhere: RowWhereResult) => {
      setRowId(rowWhere.where);
      setAliasWith(rowWhere.aliasWith);
      setRowSource(sourceId);
      onSidebarOpen?.(rowWhere.where);
    },
    [setRowId, setAliasWith, setRowSource, sourceId, onSidebarOpen],
  );

  const onCloseSidebar = useCallback(() => {
    setRowId(null);
    setRowSource(null);
    // When closing the main drawer, clear the nested panel state
    // this ensures that re-opening the main drawer will not open the nested panel
    if (!isNestedPanel) {
      setContextRowId(null);
      setContextRowSource(null);
    }
  }, [
    setRowId,
    setRowSource,
    isNestedPanel,
    setContextRowId,
    setContextRowSource,
  ]);
  const renderRowDetails = useCallback(
    (r: { id: string; aliasWith?: WithClause[]; [key: string]: unknown }) => {
      if (!sourceData) {
        return <div className="p-3 text-muted">Loading...</div>;
      }
      return (
        <RowOverviewPanelWrapper
          source={sourceData}
          rowId={r.id}
          aliasWith={r.aliasWith}
        />
      );
    },
    [sourceData],
  );

  return (
    <RowSidePanelContext.Provider value={context ?? {}}>
      {sourceData && (rowSource === sourceId || !rowSource) && (
        <DBRowSidePanel
          source={sourceData}
          rowId={rowId ?? undefined}
          aliasWith={aliasWith}
          isNestedPanel={isNestedPanel}
          breadcrumbPath={breadcrumbPath}
          onClose={onCloseSidebar}
        />
      )}
      <DBSqlRowTable
        config={config}
        sourceId={sourceId}
        onRowDetailsClick={onOpenSidebar}
        highlightedLineId={rowId ?? undefined}
        enabled={enabled}
        isLive={isLive ?? true}
        queryKeyPrefix={'dbSqlRowTable'}
        onSortingChange={onSortingChange}
        denoiseResults={denoiseResults}
        initialSortBy={initialSortBy}
        renderRowDetails={renderRowDetails}
        onScroll={onScroll}
        onError={onError}
        onExpandedRowsChange={onExpandedRowsChange}
        collapseAllRows={collapseAllRows}
        variant={variant}
      />
    </RowSidePanelContext.Provider>
  );
}

enum InlineTab {
  Overview = 'overview',
  ColumnValues = 'columnValues',
}

function RowOverviewPanelWrapper({
  source,
  rowId,
  aliasWith,
}: {
  source: TSource;
  rowId: string;
  aliasWith?: WithClause[];
}) {
  // Use localStorage to persist the selected tab
  const [activeTab, setActiveTab] = useLocalStorage<InlineTab>(
    'hdx-expanded-row-default-tab',
    InlineTab.ColumnValues,
  );

  return (
    <div className="position-relative">
      <div className="px-3 pt-2 position-relative">
        <TabBar
          className="fs-8"
          items={[
            {
              text: 'Overview',
              value: InlineTab.Overview,
            },
            {
              text: 'Column Values',
              value: InlineTab.ColumnValues,
            },
          ]}
          activeItem={activeTab}
          onClick={setActiveTab}
        />
      </div>
      <div>
        {activeTab === InlineTab.Overview && (
          <div className="inline-overview-panel">
            <RowOverviewPanel
              source={source}
              rowId={rowId}
              aliasWith={aliasWith}
            />
          </div>
        )}
        {activeTab === InlineTab.ColumnValues && (
          <RowDataPanel source={source} rowId={rowId} aliasWith={aliasWith} />
        )}
      </div>
    </div>
  );
}
