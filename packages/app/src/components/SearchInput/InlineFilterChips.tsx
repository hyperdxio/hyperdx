import { memo, useCallback } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import type { FilterStateHook } from '@/searchFilters';

import { type PillItem, removePill } from '../filterPillUtils';

import styles from './InlineFilterChips.module.scss';

type InlineFilterChipsProps = {
  pills: PillItem[];
  setFilterValue: FilterStateHook['setFilterValue'];
  clearFilter: FilterStateHook['clearFilter'];
};

function InlineFilterChip({
  pill,
  onRemove,
}: {
  pill: PillItem;
  onRemove: () => void;
}) {
  const isExcluded = pill.type === 'excluded';
  const operator = isExcluded ? '!=' : pill.type === 'range' ? ':' : '=';
  const ariaLabel = `Filter ${pill.field} ${operator} ${pill.value}`;

  return (
    <Tooltip label={`${pill.field} ${operator} ${pill.value}`} openDelay={300}>
      <span
        className={isExcluded ? styles.chipExcluded : styles.chip}
        onMouseDown={e => e.preventDefault()}
        data-testid="filter-chip"
        data-field={pill.field}
        data-type={pill.type}
        data-value={pill.value}
        aria-label={ariaLabel}
      >
        <span className={styles.chipField} data-testid="filter-chip-field">
          {pill.field}
        </span>
        <span
          className={styles.chipOperator}
          data-testid="filter-chip-operator"
        >
          {operator}
        </span>
        <span className={styles.chipValue} data-testid="filter-chip-value">
          {pill.value}
        </span>
        <ActionIcon
          size={14}
          variant="transparent"
          color={isExcluded ? 'red.4' : 'gray'}
          onClick={onRemove}
          onMouseDown={e => e.preventDefault()}
          className={styles.chipClose}
          data-testid="filter-chip-remove"
          aria-label={`Remove ${ariaLabel}`}
        >
          <IconX size={8} />
        </ActionIcon>
      </span>
    </Tooltip>
  );
}

export default memo(function InlineFilterChips({
  pills,
  setFilterValue,
  clearFilter,
}: InlineFilterChipsProps) {
  const handleRemove = useCallback(
    (pill: PillItem) => {
      removePill(pill, setFilterValue, clearFilter);
    },
    [setFilterValue, clearFilter],
  );

  if (pills.length === 0) {
    return null;
  }

  return (
    <div className={styles.chipsGroup} data-testid="filter-chips-group">
      {pills.map((pill, i) => (
        <InlineFilterChip
          key={`${pill.field}-${pill.type}-${pill.value}-${i}`}
          pill={pill}
          onRemove={() => handleRemove(pill)}
        />
      ))}
    </div>
  );
});
