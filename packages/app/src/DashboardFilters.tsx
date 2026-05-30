import { useMemo } from 'react';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconHelp, IconLock, IconRefresh } from '@tabler/icons-react';

import { VirtualMultiSelect } from './components/VirtualMultiSelect/VirtualMultiSelect';
import { useDashboardFilterValues } from './hooks/useDashboardFilterValues';

interface DashboardFilterSelectProps {
  filter: DashboardFilter;
  onChange: (values: string[]) => void;
  value: string[];
  values?: string[];
  isLoading?: boolean;
}

const getAppliesToTooltip = (filter: DashboardFilter) => {
  const count = filter.appliesToSourceIds?.length ?? 0;
  if (count === 0) return 'Applies to all sources';
  return `Applies to ${count} source${count === 1 ? '' : 's'}`;
};

const DashboardFilterSelect = ({
  filter,
  onChange,
  value,
  values,
  isLoading,
}: DashboardFilterSelectProps) => {
  const sortedValues = values?.toSorted() || [];
  const tooltipText = getAppliesToTooltip(filter);
  // The chip is rendered locked when either `constant: true` is set
  // (the value comes from savedFilterValues and the viewer cannot
  // override it) or `renderMode === 'readonly'` is set explicitly.
  // The `renderMode === 'hidden'` case is handled one level up at
  // `visibleFilters`, which drops the chip from the bar entirely; that
  // branch never reaches this component.
  const isLocked = filter.renderMode === 'readonly' || !!filter.constant;

  return (
    <Stack gap={2}>
      <Group gap={4} align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {filter.name}
        </Text>
        {isLocked && (
          <Tooltip
            label="This filter is locked to the saved default value"
            withinPortal
          >
            <IconLock
              size={12}
              color="var(--color-text-muted)"
              data-testid={`dashboard-filter-lock-${filter.name}`}
            />
          </Tooltip>
        )}
        <Tooltip label={tooltipText} withinPortal>
          <IconHelp
            size={12}
            color="var(--color-text-muted)"
            data-testid={`dashboard-filter-help-${filter.name}`}
          />
        </Tooltip>
      </Group>
      <div style={{ width: 250 }}>
        <VirtualMultiSelect
          placeholder={value.length === 0 ? filter.name : undefined}
          values={value}
          data={sortedValues}
          disabled={isLoading || isLocked}
          onChange={onChange}
          data-testid={`dashboard-filter-select-${filter.name}`}
        />
      </div>
    </Stack>
  );
};

interface DashboardFilterProps {
  filters: DashboardFilter[];
  filterValues: FilterState;
  onSetFilterValue: (expression: string, values: string[]) => void;
  dateRange: [Date, Date];
}

const DashboardFilters = ({
  filters,
  dateRange,
  filterValues,
  onSetFilterValue,
}: DashboardFilterProps) => {
  // Filters with renderMode === 'hidden' still apply to tile WHERE clauses
  // (via the hook) but are not rendered in the filter bar. Memoize so the
  // downstream useDashboardFilterValues sees a stable reference and its
  // useQueries doesn't churn isLoading on every parent re-render.
  const visibleFilters = useMemo(
    () => filters.filter(f => f.renderMode !== 'hidden'),
    [filters],
  );

  const { data: filterValuesById, isFetching } = useDashboardFilterValues({
    filters: visibleFilters,
    dateRange,
  });

  return (
    <Group align="start">
      {visibleFilters.map(filter => {
        const queriedFilterValues = filterValuesById?.get(filter.id);
        const included = filterValues[filter.expression]?.included;
        const selectedValues = included
          ? Array.from(included).map(v => v.toString())
          : [];
        return (
          <DashboardFilterSelect
            key={filter.id}
            filter={filter}
            isLoading={!queriedFilterValues}
            onChange={values => onSetFilterValue(filter.expression, values)}
            values={queriedFilterValues?.values}
            value={selectedValues}
          />
        );
      })}
      {isFetching && <IconRefresh className="spin-animate" size={12} />}
    </Group>
  );
};

export default DashboardFilters;
