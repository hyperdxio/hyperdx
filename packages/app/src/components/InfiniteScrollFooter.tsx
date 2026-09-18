import * as React from 'react';
import { Button, Center, Group, Loader, Text } from '@mantine/core';
import { useInViewport } from '@mantine/hooks';

type LoadMoreSentinelProps = {
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  label: string;
  testId: string;
};

/**
 * Sentinel row at the bottom of a list: when scrolled into view (and more
 * pages exist), it triggers the next fetch, for infinite scroll paging.
 */
function LoadMoreSentinel({
  isFetchingNextPage,
  onLoadMore,
  label,
  testId,
}: LoadMoreSentinelProps) {
  const { ref, inViewport } = useInViewport();

  React.useEffect(() => {
    if (inViewport && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [inViewport, isFetchingNextPage, onLoadMore]);

  return (
    <Center py="sm" ref={ref} data-testid={testId}>
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Group>
    </Center>
  );
}

type InfiniteScrollFooterProps = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /**
   * Whether the *next-page* fetch failed — react-query's
   * `isFetchNextPageError`, not `isError`. A failed first page is the list's
   * own error state, not a load-more failure.
   */
  isFetchNextPageError: boolean;
  onLoadMore: () => void;
  loadingLabel: string;
  errorLabel: string;
  sentinelTestId: string;
  errorTestId: string;
};

/**
 * The bottom of an infinite-scrolling list: a sentinel that fetches the next
 * page as it comes into view, or a retry affordance when the last page fetch
 * failed. Renders nothing once every page is in.
 */
export function InfiniteScrollFooter({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
  loadingLabel,
  errorLabel,
  sentinelTestId,
  errorTestId,
}: InfiniteScrollFooterProps) {
  if (!hasNextPage) {
    return null;
  }

  // A failed page fetch must unmount the sentinel: its effect refires whenever
  // isFetchingNextPage settles back to false, so leaving it mounted after an
  // error would refetch in an unbounded loop.
  if (isFetchNextPageError) {
    return (
      <Center py="sm" data-testid={errorTestId}>
        <Group gap="xs">
          <Text size="sm" variant="danger">
            {errorLabel}
          </Text>
          <Button
            variant="secondary"
            size="compact-xs"
            loading={isFetchingNextPage}
            onClick={onLoadMore}
          >
            Retry
          </Button>
        </Group>
      </Center>
    );
  }

  return (
    <LoadMoreSentinel
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={onLoadMore}
      label={loadingLabel}
      testId={sentinelTestId}
    />
  );
}
