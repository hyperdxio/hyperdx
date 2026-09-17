import { fireEvent, screen } from '@testing-library/react';

import { InfiniteScrollFooter } from '@/components/InfiniteScrollFooter';

let mockInViewport = false;
jest.mock('@mantine/hooks', () => ({
  ...jest.requireActual('@mantine/hooks'),
  useInViewport: () => ({ ref: jest.fn(), inViewport: mockInViewport }),
}));

const defaultProps = {
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  onLoadMore: () => {},
  loadingLabel: 'Loading more things…',
  errorLabel: 'Failed to load more things.',
  sentinelTestId: 'things-load-more',
  errorTestId: 'things-load-error',
};

describe('InfiniteScrollFooter', () => {
  beforeEach(() => {
    mockInViewport = false;
  });

  it('renders nothing when there are no more pages', () => {
    renderWithMantine(
      <InfiniteScrollFooter {...defaultProps} hasNextPage={false} />,
    );

    expect(screen.queryByTestId('things-load-more')).not.toBeInTheDocument();
    expect(screen.queryByTestId('things-load-error')).not.toBeInTheDocument();
  });

  it('holds off until the sentinel is in viewport', () => {
    const onLoadMore = jest.fn();
    renderWithMantine(
      <InfiniteScrollFooter {...defaultProps} onLoadMore={onLoadMore} />,
    );

    expect(screen.getByTestId('things-load-more')).toBeInTheDocument();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('loads more once the sentinel is in viewport', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();
    renderWithMantine(
      <InfiniteScrollFooter {...defaultProps} onLoadMore={onLoadMore} />,
    );

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not re-trigger while a page is already in flight', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();
    renderWithMantine(
      <InfiniteScrollFooter
        {...defaultProps}
        isFetchingNextPage
        onLoadMore={onLoadMore}
      />,
    );

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('unmounts the sentinel on error and retries only on click', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();
    renderWithMantine(
      <InfiniteScrollFooter
        {...defaultProps}
        isFetchNextPageError
        onLoadMore={onLoadMore}
      />,
    );

    // The guard this component exists for: an in-viewport sentinel left
    // mounted after a failure refetches in an unbounded loop.
    expect(screen.queryByTestId('things-load-more')).not.toBeInTheDocument();
    expect(onLoadMore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
