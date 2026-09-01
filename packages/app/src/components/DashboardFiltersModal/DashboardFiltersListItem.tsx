import { Box, Group, Paper, Text, Tooltip } from '@mantine/core';

import styles from '@styles/DashboardFiltersModal.module.scss';

/** One icon + text row describing some aspect of the filter. */
export interface DashboardFilterAttribute {
  icon: React.ReactNode;
  /** Tooltip on the icon describing what `label` represents, where it needs one. */
  tooltip?: string;
  label: string;
  /** `data-testid` for the row, for the attributes a test needs to target. */
  testId?: string;
}

interface DashboardFilterListItemProps {
  /** Display name shown in the header and used in `data-testid` slugs. */
  name: string;
  /**
   * Appended after `name` in the header (e.g. the ` ($token)` variable hint).
   * Kept out of `name` so the `data-testid` slugs stay stable.
   */
  nameSuffix?: string;
  /** Rows describing the filter, shown under the header in the given order. */
  attributes: DashboardFilterAttribute[];
  /** Optional trailing action buttons (edit / delete). Omit for readonly items. */
  actions?: React.ReactNode;
}

/** Single card representing one filter in the modal's filter list. */
export const DashboardFilterListItem = ({
  name,
  nameSuffix,
  attributes,
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
    {attributes.map(({ icon, tooltip, label, testId }) => {
      return (
        <Group
          key={testId ?? label}
          gap="xs"
          wrap="nowrap"
          data-testid={testId}
        >
          {tooltip ? (
            <Tooltip label={tooltip} withinPortal multiline maw={400}>
              <Box style={{ display: 'flex', flexShrink: 0 }}>{icon}</Box>
            </Tooltip>
          ) : (
            <Box style={{ display: 'flex', flexShrink: 0 }}>{icon}</Box>
          )}
          <Text size="xs" truncate="end">
            {label}
          </Text>
        </Group>
      );
    })}
  </Paper>
);
