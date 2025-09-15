import React, { memo, useCallback, useState } from 'react';
import cx from 'classnames';
import { useQueryState } from 'nuqs';
import { TSource } from '@hyperdx/common-utils/dist/types';

import styles from '../../styles/LogTable.module.scss';

// Hook that provides a function to open the sidebar with specific row details
const useSidebarOpener = () => {
  const [, setRowId] = useQueryState('rowWhere');
  const [, setRowSource] = useQueryState('rowSource');

  return useCallback(
    (rowWhere: string, sourceId?: string) => {
      setRowId(rowWhere);
      setRowSource(sourceId ?? null);
    },
    [setRowId, setRowSource],
  );
};

export const ExpandedLogRow = memo(
  ({
    columnsLength,
    children,
    virtualKey,
    source,
    rowId,
    measureElement,
    virtualIndex,
  }: {
    children: React.ReactNode;
    columnsLength: number;
    virtualKey: string;
    source?: TSource;
    rowId: string;
    measureElement?: (element: HTMLElement | null) => void;
    virtualIndex?: number;
  }) => {
    const openSidebar = useSidebarOpener();

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
            <div className="position-relative">
              <div className="bg-body px-3 pt-2 position-relative">
                {openSidebar && (
                  <button
                    type="button"
                    className={cx(
                      'position-absolute top-0 end-0 mt-1 me-1 p-1 border-0 bg-transparent text-muted rounded',
                      styles.expandButton,
                    )}
                    onClick={() => openSidebar(rowId, source?.id)}
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
                {children}
              </div>
            </div>
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
      <button
        type="button"
        className={cx('btn btn-link p-0 border-0', {
          'text-success': highlightedLineId === rowId,
          'text-muted': highlightedLineId !== rowId,
        })}
        onClick={e => {
          e.stopPropagation();
          toggleRowExpansion(rowId);
        }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} log details`}
        style={{ lineHeight: 1 }}
      >
        <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
      </button>
    );
  },
  size: 8,
  enableResizing: false,
});
