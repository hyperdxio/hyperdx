import { ActionIcon, Box, Button, Tooltip } from '@mantine/core';
import { IconCode } from '@tabler/icons-react';

import styles from './QueryEditor.module.scss';

/**
 * Opens the editor for the query that the search field feeds into.
 *
 * Named for the surface rather than its contents, which keeps it true when a
 * metric source puts PromQL in there instead of SQL. It is also why it is not
 * called "SQL": the field beside it is SQL too, so the language never was the
 * distinguishing thing — the field is one clause spliced into the query at
 * `$__filters`, which is equally why this button sits outside the field.
 *
 * Icon-only while the query is still generated from the search, since that is
 * the state you can ignore. Once someone takes the query over it earns a label
 * and the amber dot, because that is when the search field stops driving the
 * query by itself.
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
  const label = edited ? 'Query editor, edited' : 'Query editor';

  if (edited) {
    return (
      <Button
        variant={open ? 'secondary' : 'subtle'}
        size="compact-xs"
        onClick={onToggle}
        leftSection={<Box className={styles.editedDot} aria-hidden />}
        aria-expanded={open}
        aria-label={label}
        data-testid="sql-toggle"
      >
        Query edited
      </Button>
    );
  }

  return (
    <Tooltip label={label} fz="xs" color="gray">
      <ActionIcon
        variant={open ? 'secondary' : 'subtle'}
        color="gray"
        size="sm"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={label}
        data-testid="sql-toggle"
      >
        <IconCode size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
