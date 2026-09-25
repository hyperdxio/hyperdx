import { Box, Group, Switch, Tooltip } from '@mantine/core';

import styles from './QueryEditor.module.scss';

/**
 * Turns advanced mode on and off: writing the whole query by hand instead of
 * building it from the search UI.
 *
 * A switch rather than a button, and in the page's top row rather than beside
 * the search field, because it changes the whole page — results, the table's
 * columns and sort, and whether the view can be saved — not just the input.
 *
 * Named for the mode rather than the language, which keeps it true when a
 * metric source puts PromQL in there instead of SQL. Once someone edits the
 * query the amber dot stays, because turning it off now discards those edits.
 */
export function ExploreSqlToggle({
  open,
  edited,
  onToggle,
}: {
  open: boolean;
  edited: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      label={edited ? 'Query edited' : 'Write the query as SQL'}
      fz="xs"
      color="gray"
    >
      <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Switch
          size="xs"
          label="Advanced"
          checked={open}
          onChange={onToggle}
          aria-description={edited ? 'Query edited' : undefined}
          data-testid="sql-toggle"
        />
        {edited && <Box className={styles.editedDot} aria-hidden />}
      </Group>
    </Tooltip>
  );
}
