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
  isInvalid,
  invalidReason,
  onRemove,
}: {
  pill: PillItem;
  isInvalid?: boolean;
  invalidReason?: string;
  onRemove: () => void;
}) {
  const isExcluded = pill.type === 'excluded';
  const operator = isExcluded ? ' != ' : pill.type === 'range' ? ': ' : ' = ';

  const tooltipLabel = isInvalid
    ? (invalidReason ??
      `Filter not applied: "${pill.field}" isn't a column on the current source. It will reapply if you switch back.`)
    : `${pill.field}${operator}${pill.value}`;

  const showDangerAccent = isExcluded && !isInvalid;

  return (
    <Tooltip label={tooltipLabel} openDelay={300} multiline maw={280}>
      <span
        data-testid={`active-filter-pill-${pill.field}`}
        data-invalid={isInvalid ? 'true' : undefined}
        style={{
          ...pillStyle,
          backgroundColor: isInvalid
            ? 'transparent'
            : isExcluded
              ? 'var(--color-bg-danger)'
              : 'var(--color-bg-hover)',
          border: isInvalid
            ? '1px dashed var(--color-border-emphasis)'
            : '1px solid transparent',
          opacity: isInvalid ? 0.75 : 1,
        }}
      >
        <Text
          span
          size="xxs"
          c="dimmed"
          fw={500}
          style={{
            flexShrink: 0,
            maxWidth: 100,
            textDecoration: isInvalid ? 'line-through' : undefined,
          }}
          truncate="start"
        >
          {pill.field}
        </Text>
        <Text
          span
          size="xxs"
          c="dimmed"
          style={{
            color: showDangerAccent ? 'var(--color-text-danger)' : undefined,
            textDecoration: isInvalid ? 'line-through' : undefined,
          }}
        >
          {operator}
        </Text>
        <Text
          span
          size="xxs"
          fw={500}
          truncate
          style={{ textDecoration: isInvalid ? 'line-through' : undefined }}
        >
          {pill.value}
        </Text>
        <ActionIcon
          size={14}
          variant="transparent"
          color="gray"
          onClick={onRemove}
          style={{
            flexShrink: 0,
            marginLeft: 2,
            color: showDangerAccent ? 'var(--color-text-danger)' : undefined,
          }}
          aria-label="Remove filter"
        >
          <IconX size={9} />
        </ActionIcon>
      </span>
    </Tooltip>
  );
}

export const ActiveFilterPills = memo(function ActiveFilterPills({
  searchFilters,
  invalidFields,
  invalidFieldReason,
  ...flexProps
}: {
  searchFilters: FilterStateHook;
  /**
   * Field names whose filters are present in state but not applied to the
   * current query (e.g. column doesn't exist on the active source). These
   * render in a muted, strikethrough, dashed-border style and are preserved
   * so the user can switch back without losing their selection.
   */
  invalidFields?: Set<string>;
  /**
   * Optional tooltip override for invalid pills. Receives the field name and
   * returns the tooltip text.
   */
  invalidFieldReason?: (field: string) => string;
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
      {visiblePills.map((pill, i) => {
        const isInvalid = invalidFields?.has(pill.field) ?? false;
        return (
          <FilterPill
            key={`${pill.field}-${pill.type}-${pill.value}-${i}`}
            pill={pill}
            isInvalid={isInvalid}
            invalidReason={
              isInvalid ? invalidFieldReason?.(pill.field) : undefined
            }
            onRemove={() => handleRemove(pill)}
          />
        );
      })}
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
