import { useCallback, useState } from 'react';
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
  onDropdownOpen?: () => void;
  onDropdownClose?: () => void;
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
  onDropdownOpen,
  onDropdownClose,
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
          // Surface loading as a dropdown hint rather than disabling the control:
          // it must stay openable so lazy (link-mode) fetches can trigger on open,
          // and a completed/empty/failed query must stay interactive so the user
          // can still clear or adjust the selection.
          loading={isLoading}
          onChange={onChange}
          onDropdownOpen={onDropdownOpen}
          onDropdownClose={onDropdownClose}
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
  // can't use the cheap per-key rollups and are far more expensive at scale.
  const [linked, setLinked] = useState(false);
  // In link mode, only fetch a filter's (constrained) values once its dropdown
  // is open — bounds the extra scans to what the user actually looks at.
  const [openFilterIds, setOpenFilterIds] = useState<Set<string>>(
    () => new Set(),
  );
  const setFilterOpen = useCallback((id: string, open: boolean) => {
    setOpenFilterIds(prev => {
      if (open === prev.has(id)) return prev;
      const next = new Set(prev);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const {
    data: filterValuesById,
    erroredFilterIds,
    isFetching,
  } = useDashboardFilterValues({
    filters,
    dateRange,
    // Only narrow by sibling selections when linked.
    filterValues: linked ? filterValues : {},
    // Lazy fetch (open dropdowns only) when linked; eager (all) when not.
    activeFilterIds: linked ? openFilterIds : undefined,
  });

  return (
    <Group align="start">
      {Object.values(filters).map(filter => {
        const queriedFilterValues = filterValuesById?.get(filter.id);
        const included = filterValues[filter.expression]?.included;
        const selectedValues = included
          ? Array.from(included).map(v => v.toString())
          : [];
        // In link mode a closed (never-opened) dropdown isn't fetched, so it
        // must read as "not loading" to stay openable; otherwise fall back to
        // the hook-level fetching state until this filter has produced an entry.
        const isInactive = linked && !openFilterIds.has(filter.id);
        const isLoadingValues = queriedFilterValues
          ? queriedFilterValues.isLoading
          : !isInactive && isFetching;
        return (
          <DashboardFilterSelect
            key={filter.id}
            filter={filter}
            isLoading={isLoadingValues}
            isError={erroredFilterIds?.has(filter.id) ?? false}
            onChange={values => onSetFilterValue(filter.expression, values)}
            values={queriedFilterValues?.values}
            value={selectedValues}
            onDropdownOpen={
              linked ? () => setFilterOpen(filter.id, true) : undefined
            }
            onDropdownClose={
              linked ? () => setFilterOpen(filter.id, false) : undefined
            }
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
