import React, { memo } from 'react';
import { Checkbox } from '@mantine/core';

import styles from '@styles/LogTable.module.scss';

export const ROW_SELECTION_COLUMN_WIDTH = 24;

const CELL_WIDTH_STYLE = {
  width: ROW_SELECTION_COLUMN_WIDTH,
  minWidth: ROW_SELECTION_COLUMN_WIDTH,
};

/** Fixed-width spacer keeping the header aligned with the checkbox cells. */
export const RowSelectionHeaderCell = () => <th style={CELL_WIDTH_STYLE} />;

export const RowSelectionCell = memo(
  ({
    rowId,
    isSelected,
    onToggle,
  }: {
    rowId: string;
    isSelected: boolean;
    onToggle: (rowId: string, options: { extendRange: boolean }) => void;
  }) => (
    <td
      className={styles.selectCell}
      style={CELL_WIDTH_STYLE}
      data-testid="row-select-cell"
    >
      <Checkbox
        className={styles.selectCheckbox}
        size="xs"
        checked={isSelected}
        aria-label="Select row"
        title="Select row, shift-click to select a range"
        data-testid="row-select-checkbox"
        // The row body is a single button that opens the side panel.
        onClick={e => e.stopPropagation()}
        onChange={e =>
          onToggle(rowId, {
            extendRange:
              e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey,
          })
        }
      />
    </td>
  ),
);

RowSelectionCell.displayName = 'RowSelectionCell';
