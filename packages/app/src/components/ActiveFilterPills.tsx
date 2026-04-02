import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Flex, FlexProps, Text, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import type { FilterStateHook } from '@/searchFilters';

const MAX_VISIBLE_PILLS = 8;

type PillItem = {
  field: string;
  value: string;
  type: 'included' | 'excluded' | 'range';
  rawValue?: string | boolean;
};

function flattenFilters(filters: FilterStateHook['filters']): PillItem[] {
  const pills: PillItem[] = [];
  for (const [field, state] of Object.entries(filters)) {
    for (const val of state.included) {
      pills.push({
        field,
        value: String(val),
        type: 'included',
        rawValue: val,
      });
    }
    for (const val of state.excluded) {
      pills.push({
        field,
        value: String(val),
        type: 'excluded',
        rawValue: val,
      });
    }
    if (state.range != null) {
      pills.push({
        field,
        value: `${state.range.min} – ${state.range.max}`,
        type: 'range',
      });
    }
  }
  return pills;
}

const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 11,
  lineHeight: '18px',
  cursor: 'default',
  whiteSpace: 'nowrap' as const,
  maxWidth: 260,
  overflow: 'hidden',
};

function FilterPill({
  pill,
  onRemove,
}: {
  pill: PillItem;
  onRemove: () => void;
}) {
  const isExcluded = pill.type === 'excluded';
  const operator = isExcluded ? ' != ' : pill.type === 'range' ? ': ' : ' = ';

  const displayValue =
    pill.value.length > 30 ? `${pill.value.slice(0, 27)}…` : pill.value;
  const displayField =
    pill.field.length > 25 ? `…${pill.field.slice(-22)}` : pill.field;

  return (
    <Tooltip
      label={`${pill.field}${operator}${pill.value}`}
      disabled={pill.value.length <= 30 && pill.field.length <= 25}
      openDelay={300}
    >
      <span
        style={{
          ...pillStyle,
          backgroundColor: isExcluded
            ? 'var(--mantine-color-red-light)'
            : 'var(--mantine-color-default-border)',
        }}
      >
        <Text
          span
          size="xxs"
          c="dimmed"
          fw={500}
          style={{ flexShrink: 0, maxWidth: 100 }}
          truncate
        >
          {displayField}
        </Text>
        <Text span size="xxs" c={isExcluded ? 'red.4' : 'dimmed'}>
          {operator}
        </Text>
        <Text span size="xxs" truncate>
          {displayValue}
        </Text>
        <ActionIcon
          size={14}
          variant="transparent"
          color={isExcluded ? 'red.4' : 'gray'}
          onClick={onRemove}
          style={{ flexShrink: 0, marginLeft: 2 }}
        >
          <IconX size={9} />
        </ActionIcon>
      </span>
    </Tooltip>
  );
}

export const ActiveFilterPills = memo(function ActiveFilterPills({
  searchFilters,
  ...flexProps
}: {
  searchFilters: FilterStateHook;
} & FlexProps) {
  const { filters, setFilterValue, clearFilter, clearAllFilters } =
    searchFilters;

  const pills = useMemo(() => flattenFilters(filters), [filters]);
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(confirmTimerRef.current);
  }, []);

  const handleRemove = useCallback(
    (pill: PillItem) => {
      if (pill.type === 'range') {
        clearFilter(pill.field);
      } else {
        setFilterValue(
          pill.field,
          pill.rawValue!,
          pill.type === 'excluded' ? 'exclude' : undefined,
        );
      }
    },
    [setFilterValue, clearFilter],
  );

  const handleClearAll = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 2000);
      return;
    }
    clearAllFilters();
    setConfirmClear(false);
    clearTimeout(confirmTimerRef.current);
  }, [confirmClear, clearAllFilters]);

  if (pills.length === 0) {
    return null;
  }

  const visiblePills = expanded ? pills : pills.slice(0, MAX_VISIBLE_PILLS);
  const hiddenCount = pills.length - MAX_VISIBLE_PILLS;

  return (
    <Flex gap={4} px="sm" wrap="wrap" align="center" {...flexProps}>
      {visiblePills.map((pill, i) => (
        <FilterPill
          key={`${pill.field}-${pill.type}-${pill.value}-${i}`}
          pill={pill}
          onRemove={() => handleRemove(pill)}
        />
      ))}
      {!expanded && hiddenCount > 0 && (
        <Text
          size="xxs"
          c="dimmed"
          style={{ cursor: 'pointer' }}
          td="underline"
          onClick={() => setExpanded(true)}
        >
          +{hiddenCount} more
        </Text>
      )}
      {expanded && hiddenCount > 0 && (
        <Text
          size="xxs"
          c="dimmed"
          style={{ cursor: 'pointer' }}
          td="underline"
          onClick={() => setExpanded(false)}
        >
          Show less
        </Text>
      )}
      {pills.length >= 2 && (
        <Text
          size="xxs"
          c={confirmClear ? 'red.4' : 'dimmed'}
          style={{ cursor: 'pointer' }}
          td="underline"
          onClick={handleClearAll}
          onMouseLeave={() => setConfirmClear(false)}
        >
          {confirmClear ? 'Confirm clear all?' : 'Clear all'}
        </Text>
      )}
    </Flex>
  );
});
