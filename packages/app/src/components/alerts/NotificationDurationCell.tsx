import * as React from 'react';
import type { AlertHistoryAnalytics } from '@hyperdx/common-utils/dist/types';
import { Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';

import { formatDurationMs } from '@/utils';

/**
 * The evaluation's notification wall time, expandable in place into a
 * per-target breakdown.
 *
 * It expands *within* the cell rather than adding child rows: the parent row
 * already owns a chevron for groups and errors, and a second row-level
 * expander competing with it would be ambiguous to click.
 */
export function NotificationDurationCell({
  analytics,
}: {
  analytics?: AlertHistoryAnalytics;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const total = analytics?.webhookDurationMs;
  const targets = analytics?.notificationTargets ?? [];

  if (total == null) {
    return <>–</>;
  }

  // Records written before per-target timing existed have the total but no
  // breakdown, so there is nothing to expand into.
  if (targets.length === 0) {
    return <Text size="sm">{formatDurationMs(total)}</Text>;
  }

  return (
    <Stack gap={2} align="flex-start">
      <UnstyledButton
        // The parent row toggles its own expansion on click; without this the
        // cell's expander would fire both.
        onClick={event => {
          event.stopPropagation();
          setExpanded(value => !value);
        }}
        aria-expanded={expanded}
        data-testid="notification-duration-toggle"
      >
        <Group gap={2} wrap="nowrap">
          <Text size="sm">{formatDurationMs(total)}</Text>
          {expanded ? (
            <IconChevronDown size={12} />
          ) : (
            <IconChevronRight size={12} />
          )}
        </Group>
      </UnstyledButton>
      <Collapse expanded={expanded}>
        <Stack gap={2} pt={2} data-testid="notification-duration-breakdown">
          {targets.map(target => (
            // Keyed on the id, not the label: two webhooks can share a name.
            <Group key={target.targetId} gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">
                {target.target}
              </Text>
              <Text size="xs">{formatDurationMs(target.durationMs)}</Text>
              {target.dispatches > 1 && (
                <Text size="xs" c="dimmed">
                  ×{target.dispatches}
                </Text>
              )}
              {target.failures > 0 && (
                <Text size="xs" c="var(--color-text-danger)">
                  {target.failures} failed
                </Text>
              )}
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}
