import { useCallback } from 'react';
import { useQueryState } from 'nuqs';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { SortingState } from '@tanstack/react-table';

import { useSource } from '@/source';
import TabBar from '@/TabBar';
import { useLocalStorage } from '@/utils';

import { RowDataPanel } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import DBRowSidePanel, {
  RowSidePanelContext,
  RowSidePanelContextProps,
} from './DBRowSidePanel';
import { BreadcrumbEntry } from './DBRowSidePanelHeader';
import { DBSqlRowTable } from './DBRowTable';

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
}: Props) {
  const { data: sourceData } = useSource({ id: sourceId });
  const [rowId, setRowId] = useQueryState('rowWhere');
  const [, setRowSource] = useQueryState('rowSource');

  const onOpenSidebar = useCallback(
    (rowWhere: string) => {
      setRowId(rowWhere);
      setRowSource(sourceId);
      onSidebarOpen?.(rowWhere);
    },
    [setRowId, setRowSource, sourceId, onSidebarOpen],
  );

  const onCloseSidebar = useCallback(() => {
    setRowId(null);
    setRowSource(null);
  }, [setRowId, setRowSource]);
  const renderRowDetails = useCallback((r: { [key: string]: unknown }) => {
    if (!sourceData) {
      return <div className="p-3 text-muted">Loading...</div>;
    }
    return (
      <RowOverviewPanelWrapper source={sourceData} rowId={r.id as string} />
    );
  }, []);

  return (
    <RowSidePanelContext.Provider value={context ?? {}}>
      {sourceData && (
        <DBRowSidePanel
          source={sourceData}
          rowId={rowId ?? undefined}
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
}: {
  source: TSource;
  rowId: string;
}) {
  // Use localStorage to persist the selected tab
  const [activeTab, setActiveTab] = useLocalStorage<InlineTab>(
    'hdx-expanded-row-default-tab',
    InlineTab.ColumnValues,
  );

  return (
    <div className="position-relative">
      <div className="bg-body px-3 pt-2 position-relative">
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
      <div className="bg-body">
        {activeTab === InlineTab.Overview && (
          <div className="inline-overview-panel">
            <RowOverviewPanel source={source} rowId={rowId} />
          </div>
        )}
        {activeTab === InlineTab.ColumnValues && (
          <RowDataPanel source={source} rowId={rowId} />
        )}
      </div>
    </div>
  );
}
