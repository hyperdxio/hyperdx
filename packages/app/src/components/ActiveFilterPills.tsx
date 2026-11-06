import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Flex, FlexProps, Text } from '@mantine/core';

import { FilterPill, FilterValueEditor } from '@/components/FilterPill';
import { useGetKeyValues } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';
import { useFormatTime } from '@/useFormatTime';

const MAX_VISIBLE_PILLS = 8;
// Cap the value list fetched for the in-pill value picker.
const VALUE_EDIT_LIMIT = 50;

// Stable identity so a caller that omits the prop doesn't invalidate the
// flattenFilters useMemo on every render.
const EMPTY_DATE_TIME_COLUMNS: ReadonlyMap<string, string> = new Map();

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
  }: { dateTimeColumns: ReadonlyMap<string, string>; formatTime: FormatTime },
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

function SearchFilterPill({
  pill,
  fieldLabel,
  enableValueEditing,
  isInvalid,
  invalidReason,
  chartConfig,
  onRemove,
  onTogglePolarity,
  onReplaceValue,
}: {
  pill: PillItem;
  fieldLabel?: string;
  enableValueEditing: boolean;
  isInvalid?: boolean;
  invalidReason?: string;
  chartConfig: BuilderChartConfigWithDateRange;
  onRemove: () => void;
  onTogglePolarity: () => void;
  onReplaceValue: (value: string) => void;
}) {
  const isExcluded = pill.type === 'excluded';
  // A range pill has no single value to copy or flip, and an unapplied filter
  // (column missing on the active source) can only be removed.
  const isEditable = enableValueEditing && pill.type !== 'range' && !isInvalid;
  const [opened, setOpened] = useState(false);

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

  const { data: keyValues, isFetching: isFetchingValues } = useGetKeyValues(
    {
      chartConfig: valueChartConfig,
      keys: [pill.field],
      limit: VALUE_EDIT_LIMIT,
    },
    { enabled: opened && isEditable },
  );
  const valueOptions = useMemo(() => keyValues?.[0]?.value ?? [], [keyValues]);

  return (
    <FilterPill
      field={fieldLabel ?? pill.field}
      operator={isExcluded ? '!=' : pill.type === 'range' ? ':' : '='}
      value={pill.value}
      displayValue={pill.displayValue}
      isExcluded={isExcluded}
      isInvalid={isInvalid}
      invalidReason={invalidReason}
      onRemove={onRemove}
      onOpenedChange={setOpened}
      renderPopover={
        isEditable
          ? close => (
              <FilterValueEditor
                value={pill.value}
                valueOptions={valueOptions}
                isLoadingValues={isFetchingValues}
                isExcluded={isExcluded}
                onReplaceValue={onReplaceValue}
                onTogglePolarity={onTogglePolarity}
                onDone={close}
              />
            )
          : undefined
      }
      data-testid={`active-filter-pill-${pill.field}`}
    />
  );
}

export const ActiveFilterPills = memo(function ActiveFilterPills({
  searchFilters,
  invalidFields,
  invalidFieldReason,
  chartConfig,
  dateTimeColumns = EMPTY_DATE_TIME_COLUMNS,
  fieldLabel,
  enableValueEditing = true,
  ...flexProps
}: {
  searchFilters: FilterStateHook;
  /** Display label only; filtering, removal and value lookup use the original field. */
  fieldLabel?: (field: string) => string;
  enableValueEditing?: boolean;
  /**
   * Map of DateTime/Date column name → ClickHouse type. Their pill values are
   * formatted to the user's locale/timezone for display, matching the results
   * table, while the underlying raw value is preserved for SQL/editing/copy.
   */
  dateTimeColumns?: ReadonlyMap<string, string>;
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
          <SearchFilterPill
            key={`${pill.field}-${pill.type}-${pill.value}-${i}`}
            pill={pill}
            fieldLabel={fieldLabel?.(pill.field)}
            enableValueEditing={enableValueEditing}
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
