import * as React from 'react';
import {
  AlertEvaluation,
  AlertInterval,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Center,
  Group,
  Loader,
  Skeleton,
  Table,
  Text,
} from '@mantine/core';
import { useInViewport } from '@mantine/hooks';

import { AlertEvaluationRow } from '@/components/alerts/AlertEvaluationRow';

type LoadMoreSentinelProps = {
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
};

/**
 * Sentinel row at the bottom of the event stream: when scrolled into view
 * (and older pages exist), it triggers the next fetch — infinite scroll in
 * `limit`-sized chunks instead of a manual load-more button.
 */
function LoadMoreSentinel({
  isFetchingNextPage,
  onLoadMore,
}: LoadMoreSentinelProps) {
  const { ref, inViewport } = useInViewport();

  React.useEffect(() => {
    if (inViewport && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [inViewport, isFetchingNextPage, onLoadMore]);

  return (
    <Center py="sm" ref={ref} data-testid="alert-evaluations-load-more">
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Loading older evaluations…
        </Text>
      </Group>
    </Center>
  );
}

type AlertEvaluationsTableProps = {
  evaluations: AlertEvaluation[];
  interval: AlertInterval;
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
};

/**
 * Datadog-style evaluation event stream: one parent row per evaluation
 * window, newest first, expandable into per-group child rows for group-by
 * alerts, with error details for failed evaluations. Fetches older windows
 * in pages as the user scrolls to the bottom.
 */
export function AlertEvaluationsTable({
  evaluations,
  interval,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: AlertEvaluationsTableProps) {
  if (isLoading) {
    return <Skeleton h={160} w="100%" />;
  }

  if (evaluations.length === 0 && isError) {
    return (
      <Center py="lg">
        <Text size="sm" c="red" data-testid="alert-evaluations-error">
          Failed to load evaluations.
        </Text>
      </Center>
    );
  }

  if (evaluations.length === 0 && !hasNextPage) {
    return (
      <Center py="lg">
        <Text size="sm" c="dimmed">
          No evaluations in the selected time range.
        </Text>
      </Center>
    );
  }

  return (
    <>
      <Table highlightOnHover data-testid="alert-evaluations-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Evaluation Window</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Latest Value</Table.Th>
            <Table.Th>Breaches</Table.Th>
            <Table.Th>Backfilled Buckets</Table.Th>
            <Table.Th>Query Duration</Table.Th>
            <Table.Th>Webhook Duration</Table.Th>
            <Table.Th>Errors</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {evaluations.map(history => (
            <AlertEvaluationRow
              key={history.createdAt}
              history={history}
              interval={interval}
            />
          ))}
        </Table.Tbody>
      </Table>
      {hasNextPage &&
        // A failed page fetch must unmount the sentinel: its effect refires
        // whenever isFetchingNextPage settles back to false, so leaving it
        // mounted after an error would refetch in an unbounded loop. Show an
        // explicit retry affordance instead.
        (isError ? (
          <Center py="sm" data-testid="alert-evaluations-load-error">
            <Group gap="xs">
              <Text size="sm" c="red">
                Failed to load older evaluations.
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
        ) : (
          <LoadMoreSentinel
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={onLoadMore}
          />
        ))}
    </>
  );
}
