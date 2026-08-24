import { Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconFilter, IconSearch } from '@tabler/icons-react';

import styles from '@styles/DashboardFiltersModal.module.scss';

interface DashboardFilterListItemProps {
  /** Display name shown in the header and used in `data-testid` slugs. */
  name: string;
  /**
   * Appended after `name` in the header (e.g. the ` ($token)` variable hint).
   * Kept out of `name` so the `data-testid` slugs stay stable.
   */
  nameSuffix?: string;
  /** Text shown next to the search icon (e.g. source name or column name). */
  queriedFrom: string;
  /** Tooltip on the search icon describing what `queriedFrom` represents. */
  queriedFromTooltip: string;
  /** Comma-joined source names this filter applies to, or undefined to hide the row. */
  appliedTo?: string;
  /** Optional trailing action buttons (edit / delete). Omit for readonly items. */
  actions?: React.ReactNode;
}

/** Single card representing one filter in the modal's filter list. */
export const DashboardFilterListItem = ({
  name,
  nameSuffix,
  queriedFrom,
  queriedFromTooltip,
  appliedTo,
  actions,
}: DashboardFilterListItemProps) => (
  <Paper
    withBorder
    className={styles.filterPaper}
    p="xs"
    variant="muted"
    data-testid={`dashboard-filter-item-${name}`}
  >
    <Group justify="space-between" className={styles.filterHeader}>
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Text size="xs" truncate="end">
          {name}
          {nameSuffix}
        </Text>
      </Group>
      {actions != null && <Group>{actions}</Group>}
    </Group>
    <Group gap="xs" wrap="nowrap">
      <Tooltip label={queriedFromTooltip} withinPortal>
        <IconSearch size={14} />
      </Tooltip>
      <Text size="xs" truncate="end">
        {queriedFrom}
      </Text>
    </Group>
    {appliedTo != null && (
      <Group
        gap="xs"
        wrap="nowrap"
        data-testid={`dashboard-filter-applies-to-${name}`}
      >
        <Tooltip
          label="Sources this filter applies to"
          withinPortal
          multiline
          maw={400}
        >
          <IconFilter size={14} style={{ flexShrink: 0 }} />
        </Tooltip>
        <Text size="xs" truncate="end">
          {appliedTo}
        </Text>
      </Group>
    )}
  </Paper>
);
