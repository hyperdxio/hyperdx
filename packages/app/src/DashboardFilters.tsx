import { Fragment, useMemo } from 'react';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Center, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconHelp,
  IconLink,
  IconRefresh,
} from '@tabler/icons-react';

import { FilterLinkToggle } from './components/FilterLinkToggle';
import { VirtualMultiSelect } from './components/VirtualMultiSelect/VirtualMultiSelect';
import {
  filtersLink,
  useDashboardFilterValues,
} from './hooks/useDashboardFilterValues';
import { useLocalStorage } from './utils';

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
  const valuesOrEmptyMemo = useMemo(() => values ?? [], [values]);
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
          data={valuesOrEmptyMemo}
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

/**
 * Groups filters by source (and metric type) for display, so filters that can
 * link to each other sit adjacent in the bar. Coarser than `filtersLink`: two
 * filters sharing an expression are grouped side by side even though they don't
 * narrow each other, since they still read from the same source. Whether a
 * chain is actually drawn between neighbors is decided by `filtersLink`.
 *
 * Stable: within-group order preserves the user-defined filter order, and
 * groups are ordered by first appearance. Exported for tests.
 */
export function groupFiltersForDisplay(
  filters: DashboardFilter[],
): DashboardFilter[][] {
  const groups = new Map<string, DashboardFilter[]>();
  for (const filter of filters) {
    const key = JSON.stringify([
      filter.source,
      filter.sourceMetricType ?? null,
    ]);
    const group = groups.get(key);
    if (group) {
      group.push(filter);
    } else {
      groups.set(key, [filter]);
    }
  }
  return [...groups.values()];
}

/**
 * Small chain icon rendered between adjacent same-source filters while link
 * mode is on, to show which filters narrow each other.
 */
const FilterChainIcon = () => (
  <Stack gap={2} data-testid="dashboard-filter-chain-icon">
    {/* Spacer to align the icon with the inputs (filters have a label row above). */}
    <Text size="xs" c="transparent" aria-hidden>
      &nbsp;
    </Text>
    <Center h={30}>
      <Tooltip
        label="Linked: these filters narrow each other's values (same source)"
        withinPortal
      >
        <IconLink size={14} color="var(--color-text-muted)" />
      </Tooltip>
    </Center>
  </Stack>
);

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
  // Persisted globally (all dashboards share it) so the preference survives
  // page loads; the Kubernetes filter bar keeps its own key.
  const [linked, setLinked] = useLocalStorage<boolean>(
    'hdx-dashboard-filters-linked',
    false,
  );

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

  // Always display linked filters adjacent (grouped by source), whether or not
  // link mode is on, so toggling it never reorders the bar.
  const filterGroups = useMemo(
    () => groupFiltersForDisplay(filters),
    [filters],
  );

  return (
    <Group align="start">
      {/* flatMap, not nested map: an array-of-arrays child list makes each
          filter's reconciliation key group-index-relative, so removing or
          reordering a group would remount the surviving filters (losing
          dropdown/search state). One flat, id-keyed list avoids that. */}
      {filterGroups.flatMap(group =>
        group.map((filter, indexInGroup) => {
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
          // Only chain neighbors that genuinely narrow each other, so the icon
          // never claims a link the query layer doesn't make.
          const previous = group[indexInGroup - 1];
          return (
            <Fragment key={filter.id}>
              {linked && previous != null && filtersLink(previous, filter) && (
                <FilterChainIcon />
              )}
              <DashboardFilterSelect
                filter={filter}
                isLoading={isLoadingValues}
                isError={erroredFilterIds?.has(filter.id) ?? false}
                onChange={values => onSetFilterValue(filter.expression, values)}
                values={queriedFilterValues?.values}
                value={selectedValues}
              />
            </Fragment>
          );
        }),
      )}
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
