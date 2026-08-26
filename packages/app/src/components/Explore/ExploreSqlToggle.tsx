import { Box, Button } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';

import styles from './QueryEditor.module.scss';

/**
 * Discloses the SQL editor, and reports whose query it is. Plain "SQL" means
 * the statement is generated from the search beside it; the dot and "edited"
 * appear only once someone has taken it over, which is the one moment the
 * extra width earns itself — it is also when the search box stops driving the
 * query on its own.
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
  const Chevron = open ? IconChevronUp : IconChevronDown;
  return (
    <Button
      variant={open ? 'secondary' : 'subtle'}
      size="compact-xs"
      onClick={onToggle}
      leftSection={
        edited ? <Box className={styles.editedDot} aria-hidden /> : undefined
      }
      rightSection={<Chevron size={14} />}
      aria-expanded={open}
      aria-label={edited ? 'SQL, edited' : 'SQL'}
      data-testid="sql-toggle"
    >
      {edited ? 'SQL edited' : 'SQL'}
    </Button>
  );
}
