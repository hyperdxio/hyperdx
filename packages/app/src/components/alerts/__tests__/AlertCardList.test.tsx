import {
  AlertState,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { AlertCardList } from '@/components/alerts/AlertCardList';
import type { AlertsPageItem } from '@/types';

// jsdom reports every element as zero-height, so the real virtualizer would
// window the list down to an arbitrary slice. Rendering every item keeps this
// about which rows the component lists, and in what order.
jest.mock('@/hooks/useVirtualList', () => ({
  useVirtualList: (count: number) => ({
    rowVirtualizer: { measureElement: () => {} },
    virtualItems: Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
    })),
    paddingTop: 0,
    paddingBottom: 0,
  }),
}));

// Controls whether the infinite-scroll sentinel reports itself as visible.
let mockInViewport = false;
jest.mock('@mantine/hooks', () => ({
  ...jest.requireActual('@mantine/hooks'),
  useInViewport: () => ({ ref: jest.fn(), inViewport: mockInViewport }),
}));

jest.mock('@/components/alerts/AlertDetails', () => ({
  AlertDetails: ({ alert }: { alert: AlertsPageItem }) => (
    <div data-testid={`alert-card-${alert._id}`} />
  ),
}));

function makeAlert(id: string, state: AlertState): AlertsPageItem {
  return {
    _id: id,
    state,
    displayName: 'Alert 1',
    tags: [],
    interval: '5m',
    threshold: 3,
    thresholdType: AlertThresholdType.ABOVE,
    channel: { type: 'webhook', webhookId: 'hook-1' },
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
  } satisfies AlertsPageItem;
}

const renderedIds = () =>
  Array.from(document.querySelectorAll('[data-testid^="alert-card-"]')).map(
    node => node.getAttribute('data-testid'),
  );

const defaultProps = {
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  onLoadMore: () => {},
};

describe('AlertCardList', () => {
  beforeEach(() => {
    mockInViewport = false;
  });

  it('lists every alert in the order given, whatever its state', () => {
    renderWithMantine(
      <AlertCardList
        {...defaultProps}
        alerts={[
          makeAlert('ok-1', AlertState.OK),
          makeAlert('alarm-1', AlertState.ALERT),
          makeAlert('pending-1', AlertState.PENDING),
        ]}
      />,
    );

    // The server pages in name order, so the component must not re-sort or
    // regroup: what it receives is what it shows.
    expect(renderedIds()).toEqual([
      'alert-card-ok-1',
      'alert-card-alarm-1',
      'alert-card-pending-1',
    ]);
  });

  it('lists disabled alerts, which the sectioned list used to drop', () => {
    renderWithMantine(
      <AlertCardList
        {...defaultProps}
        alerts={[makeAlert('disabled-1', AlertState.DISABLED)]}
      />,
    );

    expect(renderedIds()).toEqual(['alert-card-disabled-1']);
  });

  it('renders no footer once every page is loaded', () => {
    renderWithMantine(
      <AlertCardList
        {...defaultProps}
        alerts={[makeAlert('ok-1', AlertState.OK)]}
      />,
    );

    expect(screen.queryByTestId('alerts-load-more')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alerts-load-error')).not.toBeInTheDocument();
  });

  it('fetches the next page when the sentinel scrolls into view', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();

    renderWithMantine(
      <AlertCardList
        {...defaultProps}
        alerts={[makeAlert('ok-1', AlertState.OK)]}
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getByTestId('alerts-load-more')).toBeInTheDocument();
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('swaps the sentinel for a retry button when a page fetch fails', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();

    renderWithMantine(
      <AlertCardList
        {...defaultProps}
        alerts={[makeAlert('ok-1', AlertState.OK)]}
        hasNextPage
        isFetchNextPageError
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getByTestId('alerts-load-error')).toBeInTheDocument();
    // The sentinel must be gone, not merely hidden: mounted and in viewport,
    // its effect would refetch in an unbounded loop.
    expect(screen.queryByTestId('alerts-load-more')).not.toBeInTheDocument();
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
