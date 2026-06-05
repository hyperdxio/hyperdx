import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconHelp, IconRefresh } from '@tabler/icons-react';

import { VirtualMultiSelect } from './components/VirtualMultiSelect/VirtualMultiSelect';
import { useDashboardFilterValues } from './hooks/useDashboardFilterValues';

interface DashboardFilterSelectProps {
  filter: DashboardFilter;
  onChange: (values: string[]) => void;
  value: string[];
  values?: string[];
  isLoading?: boolean;
  isError?: boolean;
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
  isError,
}: DashboardFilterSelectProps) => {
  const sortedValues = values?.toSorted() || [];
  const tooltipText = getAppliesToTooltip(filter);

  return (
    <Stack gap={2}>
      <Group gap={4} align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {filter.name}
        </Text>
        <Tooltip label={tooltipText} withinPortal>
          <IconHelp
            size={12}
            color="var(--color-text-muted)"
            data-testid={`dashboard-filter-help-${filter.name}`}
          />
        </Tooltip>
        {isError && (
          <Tooltip
            label="Filter values query failed. The filter's query may be invalid."
            withinPortal
          >
            <IconAlertTriangle
              size={12}
              color="var(--color-text-danger)"
              data-testid={`dashboard-filter-error-${filter.name}`}
            />
          </Tooltip>
        )}
      </Group>
      <div style={{ width: 250 }}>
        <VirtualMultiSelect
          placeholder={value.length === 0 ? filter.name : undefined}
          values={value}
          data={sortedValues}
          // Disable only while values are genuinely loading. A completed query
          // that returned no rows (or failed) must stay interactive so the user
          // can still clear/adjust the selection instead of being stuck.
          disabled={isLoading}
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
  const {
    data: filterValuesById,
    erroredFilterIds,
    isFetching,
  } = useDashboardFilterValues({
    filters,
    dateRange,
    filterValues,
  });

  return (
    <Group align="start">
      {Object.values(filters).map(filter => {
        const queriedFilterValues = filterValuesById?.get(filter.id);
        const included = filterValues[filter.expression]?.included;
        const selectedValues = included
          ? Array.from(included).map(v => v.toString())
          : [];
        // Fall back to the hook-level fetching state only until this filter's
        // query has produced an entry; once it has (even with empty values),
        // honor its own loading flag so a finished query never stays disabled.
        const isLoadingValues = queriedFilterValues
          ? queriedFilterValues.isLoading
          : isFetching;
        return (
          <DashboardFilterSelect
            key={filter.id}
            filter={filter}
            isLoading={isLoadingValues}
            isError={erroredFilterIds?.has(filter.id) ?? false}
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
