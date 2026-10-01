import { useCallback, useState } from 'react';

import { getRowId } from '@/hooks/useRowWhere';

type SelectableRow = Record<string, unknown>;

const EMPTY_SELECTION: ReadonlyMap<string, SelectableRow> = new Map();

interface Selection {
  resetKey?: string;
  anchorId: string | null;
  rows: Map<string, SelectableRow>;
}

interface UseRowSelectionResult {
  selectedCount: number;
  /**
   * Selected rows in table display order. Rows that are no longer loaded (live
   * tail evicts pages) are appended last from the snapshot taken at selection.
   */
  getSelectedRows: () => SelectableRow[];
  isSelected: (rowId: string) => boolean;
  toggleRow: (rowId: string, options?: { extendRange?: boolean }) => void;
  clearSelection: () => void;
}

/**
 * Tracks selected table rows by `__hyperdx_id`.
 *
 * `resetKey` identifies the result set the selection belongs to. When it
 * changes the selection is dropped during render rather than in an effect, so a
 * new search cannot report rows the user can no longer see, and returning to an
 * earlier query does not resurrect the rows selected under it.
 */
export function useRowSelection(
  rows: SelectableRow[],
  {
    enabled = true,
    resetKey,
    onSelectionChange,
  }: {
    enabled?: boolean;
    resetKey?: string;
    onSelectionChange?: (hasSelection: boolean) => void;
  } = {},
): UseRowSelectionResult {
  const [selection, setSelection] = useState<Selection>(() => ({
    resetKey,
    // Anchor row for range selection (shift-click)
    anchorId: null,
    rows: new Map(),
  }));

  const isCurrent = selection.resetKey === resetKey;
  if (!isCurrent) {
    setSelection({ resetKey, anchorId: null, rows: new Map() });
  }
  const selected = enabled && isCurrent ? selection.rows : EMPTY_SELECTION;

  const clearSelection = useCallback(() => {
    setSelection({ resetKey, anchorId: null, rows: new Map() });
    onSelectionChange?.(false);
  }, [onSelectionChange, resetKey]);

  const toggleRow = useCallback(
    (
      rowId: string,
      { extendRange = false }: { extendRange?: boolean } = {},
    ) => {
      if (!enabled) {
        return;
      }
      const indexOf = (id: string) =>
        rows.findIndex(row => getRowId(row) === id);
      const targetIndex = indexOf(rowId);

      setSelection(prev => {
        const prevIsCurrent = prev.resetKey === resetKey;
        const next = new Map(prevIsCurrent ? prev.rows : []);
        const anchorId = prevIsCurrent ? prev.anchorId : null;
        const anchorIndex = anchorId != null ? indexOf(anchorId) : -1;

        // Shift-click "extend range" behavior
        if (extendRange && anchorIndex !== -1 && targetIndex !== -1) {
          const [from, to] =
            anchorIndex <= targetIndex
              ? [anchorIndex, targetIndex]
              : [targetIndex, anchorIndex];
          for (let i = from; i <= to; i++) {
            next.set(getRowId(rows[i]), rows[i]);
          }
        } else if (next.has(rowId)) {
          next.delete(rowId);
        } else if (targetIndex !== -1) {
          next.set(rowId, rows[targetIndex]);
        }

        onSelectionChange?.(next.size > 0);
        return { resetKey, anchorId: rowId, rows: next };
      });
    },
    [enabled, onSelectionChange, resetKey, rows],
  );

  const isSelected = useCallback(
    (rowId: string) => selected.has(rowId),
    [selected],
  );

  const getSelectedRows = useCallback((): SelectableRow[] => {
    if (selected.size === 0) {
      return [];
    }
    const loaded: SelectableRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const rowId = getRowId(row);
      if (selected.has(rowId)) {
        // Prefer the freshly fetched row object over the snapshot.
        loaded.push(row);
        seen.add(rowId);
      }
    }
    const evicted: SelectableRow[] = [];
    for (const [rowId, row] of selected) {
      if (!seen.has(rowId)) {
        evicted.push(row);
      }
    }
    return [...loaded, ...evicted];
  }, [rows, selected]);

  return {
    selectedCount: selected.size,
    getSelectedRows,
    isSelected,
    toggleRow,
    clearSelection,
  };
}
