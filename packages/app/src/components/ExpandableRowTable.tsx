import React, { memo, useCallback, useState } from 'react';
import cx from 'classnames';
import { useQueryState } from 'nuqs';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { IconArrowsMaximize, IconChevronRight } from '@tabler/icons-react';

import { INTERNAL_ROW_FIELDS } from '@/hooks/useRowWhere';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import styles from '../../styles/LogTable.module.scss';

// Hook that provides a function to open the sidebar with specific row details
const useSidebarOpener = () => {
  const [, setRowId] = useQueryState('rowWhere', parseAsStringEncoded);
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
              <div className="px-3 pt-2 position-relative">
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
                    <IconArrowsMaximize size={14} />
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
            'text-brand': highlightedLineId === rowId,
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
  accessorKey: INTERNAL_ROW_FIELDS.ID,
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
  enableSorting: false,
  meta: {
    className: 'text-center',
  },
});
