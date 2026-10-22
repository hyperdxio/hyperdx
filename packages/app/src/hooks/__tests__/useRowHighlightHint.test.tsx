import { renderHook } from '@testing-library/react';

import {
  RowHighlightHint,
  useRowHighlightHint,
} from '@/hooks/useRowHighlightHint';

const hintA: RowHighlightHint = {
  timestamp: 't1',
  spanId: 'span-a',
  body: 'a',
};
const hintB: RowHighlightHint = {
  timestamp: 't2',
  spanId: 'span-b',
  body: 'b',
};

function row(id: string, hint: RowHighlightHint) {
  return {
    id,
    type: 'trace',
    aliasWith: [],
    Timestamp: hint.timestamp,
    SpanId: hint.spanId,
    Body: hint.body,
  };
}

const rows = [row('where-a', hintA), row('where-b', hintB)];

function renderHint(
  overrides: Partial<Parameters<typeof useRowHighlightHint>[0]> = {},
) {
  const onClick = jest.fn();
  const view = renderHook(
    (props: Parameters<typeof useRowHighlightHint>[0]) =>
      useRowHighlightHint(props),
    {
      initialProps: {
        traceId: 'trace-1',
        initialRowHighlightHint: hintA,
        highlightedRowWhere: null as string | null,
        rows,
        onClick,
        ...overrides,
      },
    },
  );
  return { ...view, onClick };
}

describe('useRowHighlightHint', () => {
  it('yields to a selection that is already present on the first hint', () => {
    const { onClick, rerender } = renderHint({
      highlightedRowWhere: 'where-existing',
    });

    expect(onClick).not.toHaveBeenCalled();

    rerender({
      traceId: 'trace-1',
      initialRowHighlightHint: hintA,
      highlightedRowWhere: 'where-existing',
      rows,
      onClick,
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('selects the matching row when nothing is selected', () => {
    const { onClick } = renderHint();

    expect(onClick).toHaveBeenCalledWith({
      id: 'where-a',
      type: 'trace',
      aliasWith: [],
    });
  });

  it('replaces the selection when a later hint arrives', () => {
    const { onClick, rerender } = renderHint();

    rerender({
      traceId: 'trace-1',
      initialRowHighlightHint: hintB,
      highlightedRowWhere: 'where-a',
      rows,
      onClick,
    });

    expect(onClick).toHaveBeenLastCalledWith({
      id: 'where-b',
      type: 'trace',
      aliasWith: [],
    });
  });

  it('does not select again for the same hint', () => {
    const { onClick, rerender } = renderHint();

    rerender({
      traceId: 'trace-1',
      initialRowHighlightHint: hintA,
      highlightedRowWhere: 'where-a',
      rows,
      onClick,
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('yields again after the trace changes, then follows the next hint', () => {
    const { onClick, rerender } = renderHint({
      highlightedRowWhere: 'where-existing',
    });

    rerender({
      traceId: 'trace-2',
      initialRowHighlightHint: hintB,
      highlightedRowWhere: 'where-existing',
      rows,
      onClick,
    });

    expect(onClick).not.toHaveBeenCalled();

    rerender({
      traceId: 'trace-2',
      initialRowHighlightHint: hintA,
      highlightedRowWhere: 'where-existing',
      rows,
      onClick,
    });

    expect(onClick).toHaveBeenCalledWith({
      id: 'where-a',
      type: 'trace',
      aliasWith: [],
    });
  });

  it('waits until the hinted row is loaded', () => {
    const { onClick, rerender } = renderHint({ rows: [] });

    expect(onClick).not.toHaveBeenCalled();

    rerender({
      traceId: 'trace-1',
      initialRowHighlightHint: hintA,
      highlightedRowWhere: null,
      rows,
      onClick,
    });

    expect(onClick).toHaveBeenCalledWith({
      id: 'where-a',
      type: 'trace',
      aliasWith: [],
    });
  });

  it('keeps an existing selection when remounted with a different hint', () => {
    const first = renderHint({ highlightedRowWhere: 'where-a' });
    expect(first.onClick).not.toHaveBeenCalled();
    first.unmount();

    const remounted = renderHint({
      initialRowHighlightHint: hintB,
      highlightedRowWhere: 'where-a',
    });

    expect(remounted.onClick).not.toHaveBeenCalled();
  });

  it('selects the new hint when remounted after the selection was cleared', () => {
    const first = renderHint({ highlightedRowWhere: 'where-a' });
    first.unmount();

    const remounted = renderHint({
      initialRowHighlightHint: hintB,
      highlightedRowWhere: null,
    });

    expect(remounted.onClick).toHaveBeenCalledWith({
      id: 'where-b',
      type: 'trace',
      aliasWith: [],
    });
  });

  it('does not restore a selection the user cleared while the hint is unchanged', () => {
    const { onClick, rerender } = renderHint();

    rerender({
      traceId: 'trace-1',
      initialRowHighlightHint: hintA,
      highlightedRowWhere: null,
      rows,
      onClick,
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
