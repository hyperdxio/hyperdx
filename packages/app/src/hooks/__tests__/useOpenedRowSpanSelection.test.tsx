import { useQueryState } from 'nuqs';
import { render } from '@testing-library/react';

import { eventRowWhereParser } from '@/components/eventRowWhere';
import { useOpenedRowSpanSelection } from '@/hooks/useOpenedRowSpanSelection';
import {
  RowHighlightHint,
  useRowHighlightHint,
} from '@/hooks/useRowHighlightHint';

type StoredSpan = {
  id: string;
  type: string;
  aliasWith: unknown[];
  traceId: string;
};

// Mirrors nuqs: each useQueryState keeps its own state and hears updates
// through a subscription registered in useInsertionEffect, which runs before
// useLayoutEffect. Prefixed with `mock` so the hoisted jest.mock factory can
// close over it.
const mockSpanStore: {
  value: unknown;
  sets: unknown[];
  listeners: Set<(value: unknown) => void>;
} = {
  value: null,
  sets: [],
  listeners: new Set(),
};

jest.mock('nuqs', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string) => {
      const [value, setValue] = React.useState(
        key === 'eventRowWhere' ? mockSpanStore.value : null,
      );
      React.useInsertionEffect(() => {
        if (key !== 'eventRowWhere') {
          return undefined;
        }
        const listener = (next: unknown) => setValue(next);
        mockSpanStore.listeners.add(listener);
        return () => {
          mockSpanStore.listeners.delete(listener);
        };
      }, [key]);
      const set = React.useCallback(
        (next: unknown) => {
          if (key !== 'eventRowWhere') {
            return;
          }
          mockSpanStore.value = next;
          mockSpanStore.sets.push(next);
          mockSpanStore.listeners.forEach(listener => listener(next));
        },
        [key],
      );
      return [value, set];
    },
  };
});

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

const spanA: StoredSpan = {
  id: 'where-a',
  type: 'trace',
  aliasWith: [],
  traceId: 'trace-1',
};

function Waterfall({ hint }: { hint: RowHighlightHint }) {
  const [eventRowWhere, setEventRowWhere] = useQueryState(
    'eventRowWhere',
    eventRowWhereParser,
  );
  const highlightedRowWhere =
    eventRowWhere != null && eventRowWhere.traceId === 'trace-1'
      ? eventRowWhere.id
      : null;

  useRowHighlightHint({
    traceId: 'trace-1',
    initialRowHighlightHint: hint,
    highlightedRowWhere,
    rows,
    onClick: where => setEventRowWhere({ ...where, traceId: 'trace-1' }),
  });
  return null;
}

function Panel({ rowId, hint }: { rowId: string; hint: RowHighlightHint }) {
  useOpenedRowSpanSelection(rowId);
  return <Waterfall hint={hint} />;
}

describe('useOpenedRowSpanSelection', () => {
  beforeEach(() => {
    mockSpanStore.value = spanA;
    mockSpanStore.sets = [];
    mockSpanStore.listeners = new Set();
  });

  it('keeps a URL selection on the first mount', () => {
    render(<Panel rowId="row-a" hint={hintA} />);

    expect(mockSpanStore.sets).toEqual([]);
    expect(mockSpanStore.value).toEqual(spanA);
  });

  it('clears the previous span before a cached waterfall applies the next hint', () => {
    const view = render(<Panel rowId="row-a" hint={hintA} />);

    view.rerender(<Panel rowId="row-b" hint={hintB} />);

    expect(mockSpanStore.sets[0]).toBeNull();
    expect(mockSpanStore.value).toEqual({
      id: 'where-b',
      type: 'trace',
      aliasWith: [],
      traceId: 'trace-1',
    });
  });
});
