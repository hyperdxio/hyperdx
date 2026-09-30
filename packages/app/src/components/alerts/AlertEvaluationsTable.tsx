import * as React from 'react';
import {
  AlertEvaluation,
  AlertInterval,
} from '@hyperdx/common-utils/dist/types';
import { Center, Skeleton, Table, Text, Tooltip } from '@mantine/core';

import { AlertEvaluationRow } from '@/components/alerts/AlertEvaluationRow';
import { InfiniteScrollFooter } from '@/components/InfiniteScrollFooter';

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
            <Table.Th>Evaluation window</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Latest value</Table.Th>
            <Table.Th>Breaches</Table.Th>
            <Table.Th>Backfilled buckets</Table.Th>
            <Table.Th>Query duration</Table.Th>
            <Table.Th>
              <Tooltip
                label="Wall time delivering this evaluation's notifications, including retries. Targets are dispatched concurrently, so the slowest one in each dispatch round sets this figure."
                multiline
                maw={320}
                withArrow
                color="dark"
              >
                <span>Notification duration</span>
              </Tooltip>
            </Table.Th>
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
      <InfiniteScrollFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        isFetchNextPageError={isError}
        onLoadMore={onLoadMore}
        loadingLabel="Loading older evaluations…"
        errorLabel="Failed to load older evaluations."
        sentinelTestId="alert-evaluations-load-more"
        errorTestId="alert-evaluations-load-error"
      />
    </>
  );
}
