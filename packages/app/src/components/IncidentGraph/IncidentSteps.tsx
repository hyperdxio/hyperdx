import cx from 'classnames';
import { Badge, type BadgeState } from '@clickhouse/click-ui';
import { Code, Group, Paper, Text, Timeline, Title } from '@mantine/core';
import {
  IconCheck,
  IconQuestionMark,
  IconThumbUp,
  IconX,
} from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';

import type { KgAction, KgOutcome } from './types';

import styles from './IncidentGraph.module.scss';

const OUTCOME: Record<
  KgOutcome,
  { label: string; state: BadgeState; color: string; Icon: typeof IconCheck }
> = {
  led_to_fix: {
    label: 'Led to fix',
    state: 'success',
    color: 'var(--color-text-success)',
    Icon: IconCheck,
  },
  useful: {
    label: 'Useful',
    state: 'info',
    color: 'var(--color-text-info)',
    Icon: IconThumbUp,
  },
  unknown: {
    label: 'Unknown',
    state: 'neutral',
    color: 'var(--color-text-muted)',
    Icon: IconQuestionMark,
  },
  dead_end: {
    label: 'Dead end',
    state: 'danger',
    color: 'var(--color-text-danger)',
    Icon: IconX,
  },
};

function Step({ action }: { action: KgAction }) {
  const outcome = OUTCOME[action.outcome];
  const hasArgs = Object.keys(action.args).length > 0;
  return (
    <>
      <Group gap={6} mb={4}>
        <Badge size="sm" text={outcome.label} state={outcome.state} />
        <Text size="xs" c="dimmed">
          {action.actionType}
        </Text>
        {action.tool && <Code>{action.tool}</Code>}
      </Group>
      <Text
        size="sm"
        className={cx({ [styles.deadEnd]: action.outcome === 'dead_end' })}
      >
        {action.summary}
      </Text>
      {action.reason && (
        <Text size="xs" c="dimmed">
          Why: {action.reason}
        </Text>
      )}
      {hasArgs && (
        <Code style={{ wordBreak: 'break-all' }}>
          {JSON.stringify(action.args)}
        </Code>
      )}
    </>
  );
}

export function IncidentSteps({
  actions,
  activeSeq,
  onSelect,
}: {
  actions: KgAction[];
  activeSeq: number | undefined;
  onSelect: (action: KgAction) => void;
}) {
  if (actions.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No steps recorded"
        description="The agent did not record any steps for this incident."
      />
    );
  }
  return (
    <Paper withBorder p="sm">
      <Title order={6} mb="sm">
        Steps
      </Title>
      <Timeline bulletSize={20} lineWidth={2}>
        {actions.map(a => {
          const { Icon, color } = OUTCOME[a.outcome];
          return (
            <Timeline.Item
              key={a.seq}
              bullet={<Icon size={12} color={color} />}
              data-testid={`incident-step-${a.seq}`}
            >
              <div
                role="button"
                tabIndex={0}
                className={cx(styles.step, {
                  [styles.activeStep]: a.seq === activeSeq,
                })}
                onClick={() => onSelect(a)}
                onKeyDown={e => e.key === 'Enter' && onSelect(a)}
              >
                <Step action={a} />
              </div>
            </Timeline.Item>
          );
        })}
      </Timeline>
    </Paper>
  );
}
