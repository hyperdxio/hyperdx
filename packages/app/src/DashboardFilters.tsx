import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Group, MultiSelect } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

import { useDashboardFilterValues } from './hooks/useDashboardFilterValues';
import { FilterState } from './searchFilters';

interface DashboardFilterSelectProps {
  filter: DashboardFilter;
  onChange: (values: string[]) => void;
  value: string[];
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
    <MultiSelect
      placeholder={value.length === 0 ? filter.name : undefined}
      value={value}
      data={selectValues || []}
      searchable
      clearable
      size="xs"
      maxDropdownHeight={280}
      disabled={isLoading}
      variant="filled"
      w={250}
      limit={20}
      onChange={onChange}
      data-testid={`dashboard-filter-select-${filter.name}`}
    />
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
  const { data: filterValuesById, isFetching } = useDashboardFilterValues({
    filters,
    dateRange,
  });

  return (
    <Group mt="sm" align="start">
      {Object.values(filters).map(filter => {
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
