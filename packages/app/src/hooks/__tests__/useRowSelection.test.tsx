import { act, renderHook } from '@testing-library/react';

import { useRowSelection } from '@/hooks/useRowSelection';
import { INTERNAL_ROW_FIELDS } from '@/hooks/useRowWhere';

const makeRows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    [INTERNAL_ROW_FIELDS.ID]: `id-${i + offset}`,
    body: `row ${i + offset}`,
  }));

const idsOf = (rows: Record<string, any>[]) =>
  rows.map(row => row[INTERNAL_ROW_FIELDS.ID]);

describe('useRowSelection', () => {
  it('toggles a row on and off', () => {
    const rows = makeRows(3);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => result.current.toggleRow('id-1'));
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isSelected('id-1')).toBe(true);

    act(() => result.current.toggleRow('id-1'));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.getSelectedRows()).toEqual([]);
  });

  it('keeps both rows when two clicks land in the same tick', () => {
    const rows = makeRows(3);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => {
      result.current.toggleRow('id-0');
      result.current.toggleRow('id-1');
    });

    expect(idsOf(result.current.getSelectedRows())).toEqual(['id-0', 'id-1']);
  });

  it('shift-clicking forward selects the inclusive range', () => {
    const rows = makeRows(5);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => result.current.toggleRow('id-1'));
    act(() => result.current.toggleRow('id-3', { extendRange: true }));

    expect(idsOf(result.current.getSelectedRows())).toEqual([
      'id-1',
      'id-2',
      'id-3',
    ]);
  });

  it('shift-clicking backward selects the inclusive range', () => {
    const rows = makeRows(5);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => result.current.toggleRow('id-3'));
    act(() => result.current.toggleRow('id-1', { extendRange: true }));

    expect(idsOf(result.current.getSelectedRows())).toEqual([
      'id-1',
      'id-2',
      'id-3',
    ]);
  });

  it('shift-clicking never deselects an already selected row', () => {
    const rows = makeRows(4);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => result.current.toggleRow('id-0'));
    act(() => result.current.toggleRow('id-2'));
    act(() => result.current.toggleRow('id-0', { extendRange: true }));

    expect(idsOf(result.current.getSelectedRows())).toEqual([
      'id-0',
      'id-1',
      'id-2',
    ]);
  });

  it('falls back to a plain toggle when the anchor is no longer loaded', () => {
    const { result, rerender } = renderHook(
      ({ rows }) => useRowSelection(rows),
      { initialProps: { rows: makeRows(4) } },
    );

    act(() => result.current.toggleRow('id-0'));
    // Live tail evicts the page holding the anchor.
    rerender({ rows: makeRows(3, 2) });
    act(() => result.current.toggleRow('id-4', { extendRange: true }));

    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected('id-4')).toBe(true);
  });

  it('returns selected rows in display order', () => {
    const rows = makeRows(4);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => result.current.toggleRow('id-3'));
    act(() => result.current.toggleRow('id-0'));
    act(() => result.current.toggleRow('id-2'));

    expect(idsOf(result.current.getSelectedRows())).toEqual([
      'id-0',
      'id-2',
      'id-3',
    ]);
  });

  it('survives a rows array identity change', () => {
    const { result, rerender } = renderHook(
      ({ rows }) => useRowSelection(rows),
      { initialProps: { rows: makeRows(3) } },
    );

    act(() => result.current.toggleRow('id-1'));
    rerender({ rows: makeRows(3) });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isSelected('id-1')).toBe(true);
  });

  it('keeps rows that have been evicted, appended after the loaded ones', () => {
    const { result, rerender } = renderHook(
      ({ rows }) => useRowSelection(rows),
      { initialProps: { rows: makeRows(4) } },
    );

    act(() => result.current.toggleRow('id-0'));
    act(() => result.current.toggleRow('id-3'));
    rerender({ rows: makeRows(3, 2) });

    expect(idsOf(result.current.getSelectedRows())).toEqual(['id-3', 'id-0']);
  });

  it('prefers the freshly fetched row object over the snapshot', () => {
    const stale = [{ [INTERNAL_ROW_FIELDS.ID]: 'id-0', body: 'stale' }];
    const fresh = [{ [INTERNAL_ROW_FIELDS.ID]: 'id-0', body: 'fresh' }];
    const { result, rerender } = renderHook(
      ({ rows }) => useRowSelection(rows),
      { initialProps: { rows: stale } },
    );

    act(() => result.current.toggleRow('id-0'));
    rerender({ rows: fresh });

    expect(result.current.getSelectedRows()[0].body).toBe('fresh');
  });

  it('clears the selection', () => {
    const rows = makeRows(3);
    const { result } = renderHook(() => useRowSelection(rows));

    act(() => result.current.toggleRow('id-0'));
    act(() => result.current.clearSelection());

    expect(result.current.selectedCount).toBe(0);
  });

  it('clears when the reset key changes', () => {
    const rows = makeRows(3);
    const { result, rerender } = renderHook(
      ({ resetKey }) => useRowSelection(rows, { resetKey }),
      { initialProps: { resetKey: 'search-a' } },
    );

    act(() => result.current.toggleRow('id-0'));
    rerender({ resetKey: 'search-b' });

    expect(result.current.selectedCount).toBe(0);
  });

  it('does not restore the selection when the reset key reverts', () => {
    const rows = makeRows(3);
    const { result, rerender } = renderHook(
      ({ resetKey }) => useRowSelection(rows, { resetKey }),
      { initialProps: { resetKey: 'search-a' } },
    );

    act(() => result.current.toggleRow('id-0'));
    rerender({ resetKey: 'search-b' });
    rerender({ resetKey: 'search-a' });

    expect(result.current.selectedCount).toBe(0);
  });

  it('reports whether a selection exists', () => {
    const rows = makeRows(3);
    const onSelectionChange = jest.fn();
    const { result } = renderHook(() =>
      useRowSelection(rows, { onSelectionChange }),
    );

    act(() => result.current.toggleRow('id-0'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(true);

    act(() => result.current.toggleRow('id-1'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(true);

    // Deselecting the last row empties the selection.
    act(() => result.current.toggleRow('id-0'));
    act(() => result.current.toggleRow('id-1'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(false);

    act(() => result.current.toggleRow('id-2'));
    act(() => result.current.clearSelection());
    expect(onSelectionChange).toHaveBeenLastCalledWith(false);
  });

  it('no-ops and clears when disabled', () => {
    const rows = makeRows(3);
    const { result, rerender } = renderHook(
      ({ enabled }) => useRowSelection(rows, { enabled }),
      { initialProps: { enabled: true } },
    );

    act(() => result.current.toggleRow('id-0'));
    rerender({ enabled: false });
    expect(result.current.selectedCount).toBe(0);

    act(() => result.current.toggleRow('id-1'));
    expect(result.current.selectedCount).toBe(0);
  });
});
