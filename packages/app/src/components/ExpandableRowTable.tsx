import React, { memo, useCallback, useState } from 'react';
import cx from 'classnames';
import { useQueryState } from 'nuqs';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { IconChevronRight } from '@tabler/icons-react';

import { useLocalStorage } from '@/utils';

import TabBar from '../TabBar';

import { RowDataPanel } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';

import styles from '../../styles/LogTable.module.scss';

enum InlineTab {
  Overview = 'overview',
  ColumnValues = 'columnValues',
}

// Hook that provides a function to open the sidebar with specific row details
const useSidebarOpener = () => {
  const [, setRowId] = useQueryState('rowWhere');
  const [, setRowSource] = useQueryState('rowSource');

  return useCallback(
    (rowWhere: string, sourceId: string) => {
      setRowId(rowWhere);
      setRowSource(sourceId);
    },
    [setRowId, setRowSource],
  );
};

export const ExpandedLogRow = memo(
  ({
    columnsLength,
    virtualKey,
    source,
    rowId,
    measureElement,
    virtualIndex,
  }: {
    columnsLength: number;
    virtualKey: string;
    source: TSource | undefined;
    rowId: string;
    measureElement?: (element: HTMLElement | null) => void;
    virtualIndex?: number;
  }) => {
    const openSidebar = useSidebarOpener();

    // Use localStorage to persist the selected tab
    const [activeTab, setActiveTab] = useLocalStorage<InlineTab>(
      'hdx-expanded-row-default-tab',
      InlineTab.ColumnValues,
    );

    return (
      <tr
        data-testid={`expanded-row-${rowId}`}
        key={`${virtualKey}-expanded`}
        className={styles.expandedRow}
        data-index={virtualIndex}
        ref={measureElement}
      >
        <td colSpan={columnsLength} className="p-0 border-0">
          <div className={cx('mx-2 mb-2 rounded', styles.expandedRowContent)}>
            {source ? (
              <>
                <div className="position-relative">
                  <div className="bg-body px-3 pt-2 position-relative">
                    {openSidebar && (
                      <button
                        type="button"
                        className={cx(
                          'position-absolute top-0 end-0 mt-1 me-1 p-1 border-0 bg-transparent text-muted rounded',
                          styles.expandButton,
                        )}
                        onClick={() => openSidebar(rowId, source.id)}
                        title="Open in sidebar"
                        aria-label="Open in sidebar"
                        style={{
                          zIndex: 1,
                          fontSize: '12px',
                          lineHeight: 1,
                        }}
                      >
                        <i className="bi bi-arrows-angle-expand" />
                      </button>
                    )}
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
              </>
            ) : (
              <div className="p-3 text-muted">Loading...</div>
            )}
          </div>
        </td>
      </tr>
    );
  },
);

export interface ExpandableRowTableProps {
  // Expansion state management
  expandedRows: Record<string, boolean>;
  onToggleRowExpansion: (rowId: string) => void;
  onExpandedRowsChange?: (hasExpandedRows: boolean) => void;
  collapseAllRows?: boolean;
  showExpandButton?: boolean;

  // Row data
  source?: TSource;
  getRowId: (row: Record<string, any>) => string;

  // Table display
  highlightedLineId?: string;
}

// Hook for managing expansion state
export const useExpandableRows = (
  onExpandedRowsChange?: (hasExpandedRows: boolean) => void,
) => {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRowExpansion = useCallback(
    (rowId: string) => {
      setExpandedRows(prev => {
        const newExpandedRows = {
          ...prev,
          [rowId]: !prev[rowId],
        };

        // Check if any rows are expanded and notify parent
        const hasExpandedRows = Object.values(newExpandedRows).some(Boolean);
        onExpandedRowsChange?.(hasExpandedRows);

        return newExpandedRows;
      });
    },
    [onExpandedRowsChange],
  );

  // Effect to collapse all rows when requested by parent
  const collapseAllRows = useCallback(() => {
    setExpandedRows({});
    onExpandedRowsChange?.(false);
  }, [onExpandedRowsChange]);

  return {
    expandedRows,
    toggleRowExpansion,
    collapseAllRows,
  };
};

const ExpandButton = memo(
  ({
    rowId,
    isExpanded,
    highlightedLineId,
    toggleRowExpansion,
  }: {
    rowId: string;
    isExpanded: boolean;
    highlightedLineId?: string;
    toggleRowExpansion: (rowId: string) => void;
  }) => {
    return (
      <span className="d-flex align-items-center justify-content-center">
        <button
          type="button"
          className={cx(styles.expandButton, {
            [styles.expanded]: isExpanded,
            'text-success': highlightedLineId === rowId,
            'text-muted': highlightedLineId !== rowId,
          })}
          onClick={e => {
            e.stopPropagation();
            toggleRowExpansion(rowId);
          }}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} log details`}
        >
          <IconChevronRight size={16} />
        </button>
        <span className={styles.expandButtonSeparator} />
      </span>
    );
  },
);

ExpandButton.displayName = 'ExpandButton';

// Utility function for creating expand button column
export const createExpandButtonColumn = (
  expandedRows: Record<string, boolean>,
  toggleRowExpansion: (rowId: string) => void,
  highlightedLineId?: string,
) => ({
  id: 'expand-btn',
  accessorKey: '__hyperdx_id',
  header: () => '',
  cell: (info: any) => {
    const rowId = info.getValue() as string;
    const isExpanded = expandedRows[rowId] ?? false;

    return (
      <ExpandButton
        rowId={rowId}
        isExpanded={isExpanded}
        highlightedLineId={highlightedLineId}
        toggleRowExpansion={toggleRowExpansion}
      />
    );
  },
  size: 32,
  enableResizing: false,
  meta: {
    className: 'text-center',
  },
});
