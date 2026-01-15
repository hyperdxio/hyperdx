import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Group, Select } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

import { useDashboardFilterKeyValues } from './hooks/useDashboardFilterValues';
import { FilterState } from './searchFilters';

interface DashboardFilterSelectProps {
  filter: DashboardFilter;
  onChange: (value: string | null) => void;
  value?: string | null;
  values?: string[];
  isLoading?: boolean;
}

const DashboardFilterSelect = ({
  filter,
  onChange,
  value,
  values,
  isLoading,
}: DashboardFilterSelectProps) => {
  const selectValues = values?.toSorted().map(value => ({
    value,
    label: value,
  }));

  return (
    <Select
      placeholder={filter.name}
      value={value ?? null} // null clears the select, undefined makes the select uncontrolled
      data={selectValues || []}
      searchable
      clearable
      allowDeselect
      size="xs"
      maxDropdownHeight={280}
      disabled={isLoading}
      variant="filled"
      w={200}
      limit={20}
      onChange={onChange}
    />
  );
};

interface DashboardFilterProps {
  filters: DashboardFilter[];
  filterValues: FilterState;
  onSetFilterValue: (expression: string, value: string | null) => void;
  dateRange: [Date, Date];
}

const DashboardFilters = ({
  filters,
  dateRange,
  filterValues,
  onSetFilterValue,
}: DashboardFilterProps) => {
  const { data: filterValuesBySource, isFetching } =
    useDashboardFilterKeyValues({ filters, dateRange });

  return (
    <Group mt="sm">
      {Object.values(filters).map(filter => {
        const queriedFilterValues = filterValuesBySource?.get(
          filter.expression,
        );
        return (
          <DashboardFilterSelect
            key={filter.id}
            filter={filter}
            isLoading={!queriedFilterValues}
            onChange={value => onSetFilterValue(filter.expression, value)}
            values={queriedFilterValues?.values}
            value={filterValues[filter.expression]?.included
              .values()
              .next()
              .value?.toString()}
          />
        );
      })}
      {isFetching && <IconRefresh className="spin-animate" size={12} />}
    </Group>
  );
};

export default DashboardFilters;
