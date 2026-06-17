import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Flex,
  FlexProps,
  Popover,
  Select,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconCopy,
  IconFilter,
  IconFilterX,
  IconX,
} from '@tabler/icons-react';

import { useGetKeyValues } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';
import { useFormatTime } from '@/useFormatTime';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

const MAX_VISIBLE_PILLS = 8;
// Cap the value list fetched for the in-pill value picker.
const VALUE_EDIT_LIMIT = 50;

// Stable identity so a caller that omits the prop doesn't invalidate the
// flattenFilters useMemo on every render.
const EMPTY_DATE_TIME_COLUMNS: ReadonlySet<string> = new Set();

type FormatTime = ReturnType<typeof useFormatTime>;

type PillItem = {
  field: string;
  value: string;
  type: 'included' | 'excluded' | 'range';
  rawValue?: string | boolean;
  // Display-only label for the pill (e.g. a DateTime value formatted to the
  // user's locale/timezone). The raw `value`/`rawValue` are kept intact for
  // SQL generation, value editing, copy, and the URL round-trip.
  displayValue?: string;
};

function flattenFilters(
  filters: FilterStateHook['filters'],
  {
    dateTimeColumns,
    formatTime,
  }: { dateTimeColumns: ReadonlySet<string>; formatTime: FormatTime },
): PillItem[] {
  const pills: PillItem[] = [];

  const formatDisplayValue = (field: string, val: string | boolean) =>
    dateTimeColumns.has(field) && typeof val === 'string'
      ? formatTime(val, { format: 'withMs' })
      : undefined;

  for (const [field, state] of Object.entries(filters)) {
    for (const val of state.included) {
      pills.push({
        field,
        value: String(val),
        type: 'included',
        rawValue: val,
        displayValue: formatDisplayValue(field, val),
      });
    }
    for (const val of state.excluded) {
      pills.push({
        field,
        value: String(val),
        type: 'excluded',
        rawValue: val,
        displayValue: formatDisplayValue(field, val),
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
  chartConfig,
  onRemove,
  onTogglePolarity,
  onReplaceValue,
}: {
  pill: PillItem;
  isInvalid?: boolean;
  invalidReason?: string;
  chartConfig: BuilderChartConfigWithDateRange;
  onRemove: () => void;
  onTogglePolarity: () => void;
  onReplaceValue: (value: string) => void;
}) {
  const isExcluded = pill.type === 'excluded';
  const operator = isExcluded ? ' != ' : pill.type === 'range' ? ': ' : ' = ';

  // A range pill has no single value to copy or flip, and an unapplied filter
  // (column missing on the active source) can only be removed. Both keep the
  // plain remove-only pill; only included/excluded pills open the action menu.
  const isEditable = pill.type !== 'range' && !isInvalid;
  const polarityLabel = isExcluded ? 'Include' : 'Exclude';

  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  // The picker lists values to switch this pill to, so it must not be scoped
  // by the active query or by the pill's own filter. Reusing chartConfig
  // verbatim only ever returns values already matching the current filters, so
  // an included pill would list just its own value. Clear where + filters to
  // list all of the field's values in range, like the sidebar facet list's
  // default "Show All Values" behavior.
  const valueChartConfig = useMemo(
    () => ({ ...chartConfig, where: '', filters: [] }),
    [chartConfig],
  );

  // Fetch the field's values for the in-pill value picker, only while the
  // menu is open (and never for range / not-applied pills).
  const { data: keyValues, isFetching: isFetchingValues } = useGetKeyValues(
    {
      chartConfig: valueChartConfig,
      keys: [pill.field],
      limit: VALUE_EDIT_LIMIT,
    },
    { enabled: opened && isEditable },
  );
  const valueOptions = useMemo(
    () => Array.from(new Set([pill.value, ...(keyValues?.[0]?.value ?? [])])),
    [keyValues, pill.value],
  );

  const label = pill.displayValue ?? pill.value;
  const tooltipLabel = isInvalid
    ? (invalidReason ??
      `Filter not applied: "${pill.field}" isn't a column on the current source. It will reapply if you switch back.`)
    : `${pill.field}${operator}${label}`;

  const showDangerAccent = isExcluded && !isInvalid;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(pill.value);
    if (!ok) {
      notifications.show({ color: 'red', message: CLIPBOARD_ERROR_MESSAGE });
      return;
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const pillWithTooltip = (
    <Tooltip
      label={tooltipLabel}
      openDelay={300}
      multiline
      maw={280}
      disabled={isEditable && opened}
    >
      <span
        data-testid={`active-filter-pill-${pill.field}`}
        data-invalid={isInvalid ? 'true' : undefined}
        onClick={isEditable ? () => setOpened(o => !o) : undefined}
        style={{
          ...pillStyle,
          cursor: isEditable ? 'pointer' : 'default',
          backgroundColor: isInvalid
            ? 'transparent'
            : isExcluded
              ? 'var(--mantine-color-red-light)'
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
            color: showDangerAccent
              ? 'var(--mantine-color-red-light-color)'
              : undefined,
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
          {label}
        </Text>
        <ActionIcon
          size={14}
          variant="transparent"
          color="gray"
          onClick={e => {
            // Keep the one-click remove without also toggling the action menu.
            e.stopPropagation();
            onRemove();
          }}
          style={{
            flexShrink: 0,
            marginLeft: 2,
            color: showDangerAccent
              ? 'var(--mantine-color-red-light-color)'
              : undefined,
          }}
          aria-label="Remove filter"
        >
          <IconX size={9} />
        </ActionIcon>
      </span>
    </Tooltip>
  );

  if (!isEditable) {
    return pillWithTooltip;
  }

  return (
    <Popover
      position="bottom-start"
      withArrow
      shadow="md"
      radius="sm"
      opened={opened}
      onChange={setOpened}
    >
      <Popover.Target>{pillWithTooltip}</Popover.Target>
      <Popover.Dropdown p={6}>
        <Select
          size="xs"
          w={220}
          searchable
          mb={6}
          data={valueOptions}
          value={pill.value}
          onChange={value => {
            if (value && value !== pill.value) {
              onReplaceValue(value);
              setOpened(false);
            }
          }}
          comboboxProps={{ withinPortal: false }}
          nothingFoundMessage={
            isFetchingValues ? 'Loading values...' : 'No values'
          }
          aria-label="Change filter value"
        />
        <Flex gap={4} align="center">
          <Tooltip label={copied ? 'Copied' : 'Copy value'}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={handleCopy}
              aria-label="Copy value"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={polarityLabel}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={() => {
                onTogglePolarity();
                setOpened(false);
              }}
              aria-label={polarityLabel}
            >
              {isExcluded ? (
                <IconFilter size={14} />
              ) : (
                <IconFilterX size={14} />
              )}
            </ActionIcon>
          </Tooltip>
        </Flex>
      </Popover.Dropdown>
    </Popover>
  );
}

export const ActiveFilterPills = memo(function ActiveFilterPills({
  searchFilters,
  invalidFields,
  invalidFieldReason,
  chartConfig,
  dateTimeColumns = EMPTY_DATE_TIME_COLUMNS,
  ...flexProps
}: {
  searchFilters: FilterStateHook;
  dateTimeColumns?: ReadonlySet<string>;
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
  /**
   * Chart config for the active source. Passed to useGetKeyValues so the
   * in-pill value picker can list the field's values.
   */
  chartConfig: BuilderChartConfigWithDateRange;
} & FlexProps) {
  const {
    filters,
    setFilterValue,
    replaceFilterValue,
    clearFilter,
    clearAllFilters,
  } = searchFilters;

  const formatTime = useFormatTime();
  const pills = useMemo(
    () => flattenFilters(filters, { dateTimeColumns, formatTime }),
    [filters, dateTimeColumns, formatTime],
  );
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

  // Flip a value between included and excluded in place. setFilterValue's
  // 'include'/'exclude' actions already move the value across the two sets, so
  // an excluded pill goes to included and vice versa without a remove + re-add.
  const handleTogglePolarity = useCallback(
    (pill: PillItem) => {
      if (pill.rawValue == null) {
        return;
      }
      setFilterValue(
        pill.field,
        pill.rawValue,
        pill.type === 'excluded' ? 'include' : 'exclude',
      );
    },
    [setFilterValue],
  );

  // Swap a pill's value for another value of the same field, preserving the
  // pill's polarity. One atomic update (no remove + re-add double query run).
  const handleReplaceValue = useCallback(
    (pill: PillItem, newValue: string) => {
      if (pill.rawValue == null) {
        return;
      }
      replaceFilterValue(
        pill.field,
        pill.rawValue,
        newValue,
        pill.type === 'excluded' ? 'exclude' : 'include',
      );
    },
    [replaceFilterValue],
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
            chartConfig={chartConfig}
            onRemove={() => handleRemove(pill)}
            onTogglePolarity={() => handleTogglePolarity(pill)}
            onReplaceValue={value => handleReplaceValue(pill, value)}
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
