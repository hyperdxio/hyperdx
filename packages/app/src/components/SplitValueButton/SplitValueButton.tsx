import { ComponentPropsWithoutRef, Ref } from 'react';
import cx from 'classnames';
import { Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import { useCompactViewport } from '@/components/CompactViewport/useCompactViewport';

import classes from './SplitValueButton.module.scss';

/** One field by name, several as a count, or none. */
export function fieldListSummary(fields: string[]): string {
  if (fields.length === 0) return 'none';
  if (fields.length === 1) return fields[0];
  return `${fields.length} fields`;
}

type SplitValueButtonProps = {
  /** Fixed name, such as Group by, Columns, or Sort. */
  name: string;
  /** Desktop value: a field name, "3 fields", or "none". */
  summary: string;
  /** How many fields the summary counts. Drives the narrow-screen number. */
  count: number;
  /** The clause is still the source default, so the value is quiet. */
  dimmed?: boolean;
  /** Full clause, shown on hover when the value is only a summary. */
  title?: string;
  onClick: () => void;
  /** Story and test override. Otherwise follows the compact viewport. */
  compact?: boolean;
  'data-testid': string;
  ref?: Ref<HTMLButtonElement>;
} & Omit<ComponentPropsWithoutRef<'button'>, 'onClick' | 'title'>;

/**
 * Split button for a search clause: a fixed name, then the current value.
 *
 * Use it for Group by, Columns, and Sort. The name says which clause it is.
 * The value is one field, or "3 fields" when there are several. On a narrow
 * screen that count is only the number, so the row still fits.
 *
 * Group by splits the histogram, one series per value. Columns chooses and
 * orders the results table. Sort sets the row order, and a single field
 * includes its direction.
 *
 * Do not use it for an action such as Save, Run, or Apply.
 */
export function SplitValueButton({
  name,
  summary,
  count,
  dimmed,
  title,
  onClick,
  compact,
  'data-testid': testId,
  className,
  ref,
  ...others
}: SplitValueButtonProps) {
  const viewportCompact = useCompactViewport();
  const isCompact = compact ?? viewportCompact;
  const shown = isCompact && count > 1 ? String(count) : summary;

  return (
    <div className={classes.control}>
      <Text size="xs" fw={500} className={classes.label}>
        {name}
      </Text>
      <UnstyledButton
        ref={ref}
        {...others}
        className={cx(classes.target, className)}
        onClick={onClick}
        title={title}
        aria-label={`${name} ${summary}`}
        data-testid={testId}
      >
        <Text
          size="xs"
          fw={600}
          className={classes.value}
          c={dimmed ? 'dimmed' : undefined}
        >
          {shown}
        </Text>
        <IconChevronDown size={14} />
      </UnstyledButton>
    </div>
  );
}
