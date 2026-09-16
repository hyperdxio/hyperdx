import { useCallback, useRef, useState } from 'react';

import { getRowId } from '@/hooks/useRowWhere';

type SelectableRow = Record<string, unknown>;

const EMPTY_SELECTION: ReadonlyMap<string, SelectableRow> = new Map();

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
 * `resetKey` identifies the result set the selection belongs to. A selection
 * captured under a different key reads as empty rather than being cleared in an
 * effect, so a new search cannot report rows the user can no longer see.
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
  const [selection, setSelection] = useState<{
    resetKey?: string;
    rows: Map<string, SelectableRow>;
  }>(() => ({ resetKey, rows: new Map() }));
  // Used to track the anchor row for range selection (shift-click).
  const anchorIdRef = useRef<string | null>(null);

  const isCurrent = selection.resetKey === resetKey;
  const selected = enabled && isCurrent ? selection.rows : EMPTY_SELECTION;

  const clearSelection = useCallback(() => {
    anchorIdRef.current = null;
    setSelection({ resetKey, rows: new Map() });
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
      const anchorId = isCurrent ? anchorIdRef.current : null;
      const anchorIndex = anchorId != null ? indexOf(anchorId) : -1;
      const targetIndex = indexOf(rowId);
      anchorIdRef.current = rowId;

      setSelection(prev => {
        const next = new Map(
          prev.resetKey === resetKey ? prev.rows : EMPTY_SELECTION,
        );

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
        return { resetKey, rows: next };
      });
    },
    [enabled, isCurrent, onSelectionChange, resetKey, rows],
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
