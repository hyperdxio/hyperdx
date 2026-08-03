import * as React from 'react';
import { AlertHistory, AlertState } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Button,
  Center,
  Group,
  Skeleton,
  Table,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import {
  ALERT_ERROR_TYPE_LABELS,
  AlertErrorsContent,
} from '@/components/alerts/AlertHistoryCards';
import { FormatTime } from '@/useFormatTime';

export function AlertStateBadge({ state }: { state: AlertState }) {
  return stateBadge(state);
}

function stateBadge(state: AlertState) {
  switch (state) {
    case AlertState.ALERT:
      return (
        <Badge variant="light" color="red">
          Alert
        </Badge>
      );
    case AlertState.PENDING:
      return (
        <Badge variant="light" color="orange">
          Pending
        </Badge>
      );
    case AlertState.ERROR:
      return (
        <Badge variant="outline" color="red">
          Error
        </Badge>
      );
    case AlertState.OK:
      return <Badge variant="light">Ok</Badge>;
    default:
      return (
        <Badge variant="light" color="gray">
          {state}
        </Badge>
      );
  }
}

function latestValue(history: AlertHistory): number | undefined {
  const lastValues = history.lastValues;
  if (!lastValues || lastValues.length === 0) {
    return undefined;
  }
  return lastValues[lastValues.length - 1].count;
}

function EvaluationRow({ history }: { history: AlertHistory }) {
  const [expanded, setExpanded] = React.useState(false);
  const errors = history.errors ?? [];
  const hasErrors = errors.length > 0;
  const value = latestValue(history);
  const errorTypes = Array.from(new Set(errors.map(e => e.type)));

  return (
    <>
      <Table.Tr
        data-testid="alert-evaluation-row"
        onClick={hasErrors ? () => setExpanded(v => !v) : undefined}
        style={hasErrors ? { cursor: 'pointer' } : undefined}
      >
        <Table.Td>
          <FormatTime value={history.createdAt} />
        </Table.Td>
        <Table.Td>{stateBadge(history.state)}</Table.Td>
        <Table.Td>{value != null ? value : '–'}</Table.Td>
        <Table.Td>{history.counts > 0 ? history.counts : '–'}</Table.Td>
        <Table.Td>
          {hasErrors ? (
            <UnstyledButton
              onClick={e => {
                e.stopPropagation();
                setExpanded(v => !v);
              }}
              aria-label="Toggle error details"
            >
              <Group gap={4} wrap="nowrap">
                <Text size="sm" c="red">
                  {errorTypes
                    .map(type => ALERT_ERROR_TYPE_LABELS[type])
                    .join(', ')}
                </Text>
                <IconChevronDown
                  size={14}
                  style={{
                    transform: expanded ? 'rotate(180deg)' : undefined,
                    transition: 'transform 200ms',
                  }}
                />
              </Group>
            </UnstyledButton>
          ) : (
            '–'
          )}
        </Table.Td>
      </Table.Tr>
      {expanded && hasErrors && (
        <Table.Tr>
          <Table.Td colSpan={5}>
            <AlertErrorsContent errors={errors} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

/**
 * Datadog-style evaluation event stream: one row per evaluation window,
 * newest first, with expandable error details for failed evaluations.
 */
export function AlertEvaluationsTable({
  evaluations,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  evaluations: AlertHistory[];
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  if (isLoading) {
    return <Skeleton h={160} w="100%" />;
  }

  if (evaluations.length === 0) {
    return (
      <Center py="lg">
        <Text size="sm" c="dimmed">
          No evaluations recorded yet. Evaluations appear here after the alert
          runs.
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
            <Table.Th>Errors</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {evaluations.map(history => (
            <EvaluationRow key={history.createdAt} history={history} />
          ))}
        </Table.Tbody>
      </Table>
      {hasNextPage && (
        <Center py="sm">
          <Button
            variant="secondary"
            size="compact-sm"
            loading={isFetchingNextPage}
            onClick={onLoadMore}
          >
            Load older evaluations
          </Button>
        </Center>
      )}
    </>
  );
}
