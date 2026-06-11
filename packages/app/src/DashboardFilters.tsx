import { useState } from 'react';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconHelp, IconRefresh } from '@tabler/icons-react';

import { FilterLinkToggle } from './components/FilterLinkToggle';
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
          // Surface loading as a dropdown hint rather than disabling the control,
          // so a completed/empty/failed query stays interactive and the user can
          // still clear or adjust the selection.
          loading={isLoading}
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
  // "Link" mode (opt-in, off by default): each dropdown's values are narrowed by
  // the others' selections. Off by default because contingent value lookups
  // can't use the cheap per-key rollups and are more expensive at scale. When
  // on, all of a source's facets are computed in a single groupUniqArrayIf scan.
  const [linked, setLinked] = useState(false);

  const {
    data: filterValuesById,
    erroredFilterIds,
    isFetching,
  } = useDashboardFilterValues({
    filters,
    dateRange,
    // Only narrow by sibling selections when linked.
    filterValues: linked ? filterValues : {},
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
        // honor its own loading flag.
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
      {filters.length >= 2 && (
        <Stack gap={2} justify="flex-end">
          {/* Spacer to align the toggle with the inputs (filters have a label row above). */}
          <Text size="xs" c="transparent" aria-hidden>
            &nbsp;
          </Text>
          <FilterLinkToggle
            linked={linked}
            onChange={setLinked}
            data-testid="dashboard-filters-link-toggle"
          />
        </Stack>
      )}
      {isFetching && <IconRefresh className="spin-animate" size={12} />}
    </Group>
  );
};

export default DashboardFilters;
