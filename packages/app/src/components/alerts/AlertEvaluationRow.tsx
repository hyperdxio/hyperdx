import * as React from 'react';
import {
  ALERT_EVALUATION_GROUPS_LIMIT,
  ALERT_INTERVAL_TO_MINUTES,
  AlertEvaluation,
  AlertEvaluationGroup,
  AlertInterval,
  AlertState,
} from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';

import {
  ALERT_ERROR_TYPE_LABELS,
  AlertErrorsContent,
} from '@/components/alerts/AlertHistoryCards';
import { AlertStateBadge } from '@/components/alerts/AlertStateBadge';
import { FormatTime } from '@/useFormatTime';
import { formatDurationMs } from '@/utils';

import styles from '@styles/AlertsPage.module.scss';

/** Mirrors the header column count in AlertEvaluationsTable. */
const TABLE_COLUMNS = 8;

function latestValue(history: AlertEvaluation): number | undefined {
  const lastValues = history.lastValues;
  if (!lastValues || lastValues.length === 0) {
    return undefined;
  }
  return lastValues[lastValues.length - 1].count;
}

type GroupRowProps = {
  group: AlertEvaluationGroup;
};

/** Child row: one group's result within the parent evaluation window. */
function GroupRow({ group }: GroupRowProps) {
  return (
    <Table.Tr
      className={styles.evaluationChildRow}
      data-testid="alert-evaluation-group-row"
    >
      <Table.Td>
        <Group gap={6} pl="md" wrap="nowrap">
          <Text size="sm" c="dimmed" span>
            └
          </Text>
          <Text size="sm" span>
            {group.group}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        <AlertStateBadge state={group.state} />
      </Table.Td>
      <Table.Td>
        {group.lastValue != null ? group.lastValue.count : '–'}
      </Table.Td>
      <Table.Td>{group.counts > 0 ? group.counts : '–'}</Table.Td>
      <Table.Td />
      <Table.Td />
      <Table.Td />
      <Table.Td />
    </Table.Tr>
  );
}

/** Duration cell: formatted milliseconds, or a dash when not measured. */
function durationCell(ms: number | undefined) {
  return ms != null ? formatDurationMs(ms) : '–';
}

type AlertEvaluationRowProps = {
  history: AlertEvaluation;
  interval: AlertInterval;
};

/**
 * Parent row for one evaluation window, expandable into per-group child rows
 * for group-by alerts and error details for failed evaluations.
 */
export function AlertEvaluationRow({
  history,
  interval,
}: AlertEvaluationRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const errors = history.errors ?? [];
  const groups = history.groups ?? [];
  const hasErrors = errors.length > 0;
  const hasGroups = groups.length > 0;
  const value = hasGroups ? undefined : latestValue(history);
  const errorTypes = Array.from(new Set(errors.map(e => e.type)));

  // The chart plots each bucket's value at the bucket *start*, while the
  // evaluation runs at the bucket *end* (createdAt). Show the start of the
  // latest evaluated bucket so the table lines up with the chart.
  // `lastValues` are ascending, so the last entry is the newest bucket;
  // failed evaluations have no lastValues, so fall back to
  // createdAt − interval.
  const lastValues = history.lastValues ?? [];
  const lastBucketStart =
    lastValues.length > 0
      ? lastValues[lastValues.length - 1].startTime
      : new Date(
          new Date(history.createdAt).getTime() -
            ALERT_INTERVAL_TO_MINUTES[interval] * 60_000,
        );
  const evaluatedSpanStart = lastValues[0]?.startTime ?? lastBucketStart;

  const groupsTotal = history.groupsTotal ?? groups.length;
  const firingGroups = groups.filter(g => g.state === AlertState.ALERT).length;
  const omittedGroups = groupsTotal - groups.length;
  const backfilledBuckets = history.analytics?.backfilledBuckets ?? 0;
  const expandable = hasErrors || hasGroups;

  return (
    <>
      <Table.Tr
        data-testid="alert-evaluation-row"
        onClick={expandable ? () => setExpanded(v => !v) : undefined}
        style={expandable ? { cursor: 'pointer' } : undefined}
        aria-expanded={expandable ? expanded : undefined}
      >
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            {expandable ? (
              expanded ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )
            ) : (
              // Keep timestamps aligned with expandable rows
              <span style={{ width: 14 }} />
            )}
            <Tooltip
              label={
                <>
                  Evaluated <FormatTime value={evaluatedSpanStart} /> –{' '}
                  <FormatTime value={history.createdAt} />
                </>
              }
              withArrow
              color="dark"
            >
              <Text size="sm" span>
                <FormatTime value={lastBucketStart} />
              </Text>
            </Tooltip>
          </Group>
        </Table.Td>
        <Table.Td>
          <Group gap="xs" wrap="nowrap">
            <AlertStateBadge state={history.state} />
            {hasGroups && (
              <Text size="xs" c="dimmed" span>
                {firingGroups > 0
                  ? `${firingGroups}/${groupsTotal} groups firing`
                  : `${groupsTotal} groups`}
              </Text>
            )}
          </Group>
        </Table.Td>
        <Table.Td>{value != null ? value : '–'}</Table.Td>
        <Table.Td>{history.counts > 0 ? history.counts : '–'}</Table.Td>
        <Table.Td>
          {backfilledBuckets > 0 ? (
            <Tooltip
              label={`${backfilledBuckets} earlier tick${backfilledBuckets === 1 ? ' was' : 's were'} missed (job delay or failed evaluations); the bucket${backfilledBuckets === 1 ? ' was' : 's were'} backfilled in this evaluation.`}
              multiline
              maw={320}
              withArrow
              color="dark"
            >
              <Text size="sm" span>
                {backfilledBuckets}
              </Text>
            </Tooltip>
          ) : (
            '–'
          )}
        </Table.Td>
        <Table.Td>{durationCell(history.analytics?.queryDurationMs)}</Table.Td>
        <Table.Td>
          {durationCell(history.analytics?.webhookDurationMs)}
        </Table.Td>
        <Table.Td>
          {hasErrors ? (
            <Text size="sm" c="red">
              {errorTypes.map(type => ALERT_ERROR_TYPE_LABELS[type]).join(', ')}
            </Text>
          ) : (
            '–'
          )}
        </Table.Td>
      </Table.Tr>
      {expanded && (
        <>
          {groups.map(group => (
            <GroupRow key={group.group} group={group} />
          ))}
          {omittedGroups > 0 && (
            <Table.Tr className={styles.evaluationChildRow}>
              <Table.Td colSpan={TABLE_COLUMNS}>
                <Text size="sm" c="dimmed" pl="md">
                  Showing the top {ALERT_EVALUATION_GROUPS_LIMIT} of{' '}
                  {groupsTotal} groups (firing first) — additional groups
                  aren&apos;t fetched.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {hasErrors && (
            <Table.Tr className={styles.evaluationChildRow}>
              <Table.Td colSpan={TABLE_COLUMNS}>
                <Stack pl="md">
                  <AlertErrorsContent errors={errors} />
                </Stack>
              </Table.Td>
            </Table.Tr>
          )}
        </>
      )}
    </>
  );
}
