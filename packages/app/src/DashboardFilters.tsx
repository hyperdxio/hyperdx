import { useMemo, useState } from 'react';
import { FilterSelection } from '@hyperdx/common-utils/dist/dashboardFilterValues';
import {
  getFilterBroadcastTarget,
  getFilterVariableName,
  getPendingFilterValuesVariables,
  isFilterGlobalRequirement,
  isFilterRequired,
  isFilterVariableEnabled,
  isQueryExpressionFilter,
  isStaticListFilter,
} from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
} from '@hyperdx/common-utils/dist/types';
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
  /** Shown instead of the generic message when the query's failure is known. */
  errorMessage?: string;
  /**
   * Variables this filter's dropdown query needs a selection for before it can
   * match any rows.
   */
  pendingVariables?: string[];
}

/**
 * Explain a dropdown query that may list nothing until one of the variables it
 * depends on is selected. Only the bare SQL reference form gets here — the
 * macros and Lucene both have an empty state that lists every value.
 */
export const getPendingVariablesTooltip = (
  pendingVariables: string[],
): string => {
  const names = pendingVariables.map(name => `$${name}`).join(', ');
  return `Filter depends on ${names}, which ${
    pendingVariables.length === 1 ? 'has' : 'have'
  } no selected value.`;
};

/**
 * Explain a required filter that has nothing selected, naming how far the block
 * it imposes reaches.
 */
export const getRequiredFilterTooltip = (filter: DashboardFilter): string =>
  isFilterGlobalRequirement(filter)
    ? 'Required filter. No tile on this dashboard loads until it has a selection.'
    : 'Required filter. Tiles that use this filter do not load until it has a selection.';

/**
 * Describe what a filter does with the value you pick: broadcast it as a
 * condition, expose it as a variable, both, or neither.
 */
export const getFilterEffect = (
  filter: DashboardFilter,
): { hasEffect: boolean; tooltip: string } => {
  const parts: string[] = [];

  const broadcast = getFilterBroadcastTarget(filter);
  if (broadcast) {
    const count = broadcast.appliesToSourceIds?.length ?? 0;
    parts.push(
      count === 0
        ? 'Filters all sources'
        : `Filters ${count} source${count === 1 ? '' : 's'}`,
    );
  }

  const variableName = isFilterVariableEnabled(filter)
    ? getFilterVariableName(filter)
    : undefined;
  if (variableName) {
    parts.push(
      `${parts.length > 0 ? 'a' : 'A'}vailable as variable ($${variableName})`,
    );
  }

  if (parts.length === 0) {
    return {
      hasEffect: false,
      tooltip:
        'This filter neither broadcasts nor acts as a variable - it has no effect',
    };
  }
  return { hasEffect: true, tooltip: parts.join(', ') };
};

/** One of the caution icons a filter's label row can carry, with its tooltip. */
const FilterCaution = ({
  label,
  testId,
  variant = 'warning',
}: {
  label: string;
  testId: string;
  variant?: 'warning' | 'danger';
}) => (
  <Tooltip label={label} withinPortal multiline maw={400}>
    <IconAlertTriangle
      size={12}
      color={`var(--color-text-${variant})`}
      data-testid={testId}
    />
  </Tooltip>
);

const DashboardFilterSelect = ({
  filter,
  onChange,
  value,
  values,
  isLoading,
  isError,
  errorMessage,
  pendingVariables,
}: DashboardFilterSelectProps) => {
  const valuesOrEmptyMemo = useMemo(() => values ?? [], [values]);
  const effect = getFilterEffect(filter);
  const isMissingRequiredValue = isFilterRequired(filter) && value.length === 0;

  return (
    <Stack gap={2}>
      <Group gap={4} align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {filter.name}
        </Text>
        <Tooltip label={effect.tooltip} withinPortal>
          {effect.hasEffect ? (
            <IconHelp
              size={12}
              color="var(--color-text-muted)"
              data-testid={`dashboard-filter-help-${filter.name}`}
            />
          ) : (
            <IconAlertTriangle
              size={12}
              color="var(--color-text-warning)"
              data-testid={`dashboard-filter-no-effect-${filter.name}`}
            />
          )}
        </Tooltip>
        {isMissingRequiredValue && (
          <FilterCaution
            label={getRequiredFilterTooltip(filter)}
            testId={`dashboard-filter-required-${filter.name}`}
          />
        )}
        {!!pendingVariables?.length && (
          <FilterCaution
            label={getPendingVariablesTooltip(pendingVariables)}
            testId={`dashboard-filter-pending-variable-${filter.name}`}
          />
        )}
        {isError && (
          <FilterCaution
            label={
              errorMessage ??
              "Filter values query failed. The filter's query may be invalid."
            }
            testId={`dashboard-filter-error-${filter.name}`}
            variant="danger"
          />
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
          // A static list renders in the order its author wrote it.
          sort={!isStaticListFilter(filter)}
          onChange={onChange}
          data-testid={`dashboard-filter-select-${filter.name}`}
        />
      </div>
    </Stack>
  );
};

/** Stable identity for the unlinked case, so the memo below doesn't re-run. */
const EMPTY_SELECTIONS: ReadonlyMap<string, FilterSelection> = new Map();

interface DashboardFilterProps {
  filters: DashboardFilter[];
  selectionByFilterId: ReadonlyMap<string, FilterSelection>;
  onSetFilterValue: (filterId: string, values: string[]) => void;
  dateRange: [Date, Date];
  /**
   * The dashboard's variables and their current selections. Defined only when
   * filters on this dashboard can be exposed as variables at all, so it doubles
   * as the gate for variable-specific copy.
   */
  variables?: ChartVariable[];
}

const DashboardFilters = ({
  filters,
  dateRange,
  selectionByFilterId,
  onSetFilterValue,
  variables,
}: DashboardFilterProps) => {
  // "Link" mode (opt-in, off by default): each dropdown's values are narrowed by
  // the others' selections. Off by default because contingent value lookups
  // can't use the cheap per-key rollups and are more expensive at scale. When
  // on, all of a source's facets are computed in a single groupUniqArrayIf scan.
  const [linked, setLinked] = useState(false);

  const {
    data: filterValuesById,
    erroredFilterIds,
    filterErrorMessages,
    isFetching,
  } = useDashboardFilterValues({
    filters,
    dateRange,
    variables,
    // Only narrow by sibling selections when linked.
    selectionByFilterId: linked ? selectionByFilterId : EMPTY_SELECTIONS,
  });

  // Linking narrows queried dropdowns by sibling selections; a static
  // list can neither constrain nor be constrained, so it doesn't count.
  const linkableFiltersCount = useMemo(
    () => filters.filter(isQueryExpressionFilter).length,
    [filters],
  );

  return (
    <Group align="start">
      {filters.map(filter => {
        const queriedFilterValues = filterValuesById?.get(filter.id);
        const included = selectionByFilterId.get(filter.id)?.included;
        const selectedValues = included
          ? Array.from(included).map(v => v.toString())
          : [];
        // Fall back to the hook-level fetching state only until this filter's
        // query has produced an entry; once it has (even with empty values),
        // honor its own loading flag.
        const isLoadingValues = queriedFilterValues
          ? queriedFilterValues.isLoading
          : isFetching;
        // Only a queried dropdown has a values query that can await a
        // variable's selection.
        const pendingVariables = isQueryExpressionFilter(filter)
          ? getPendingFilterValuesVariables(filter, variables)
          : undefined;
        return (
          <DashboardFilterSelect
            key={filter.id}
            filter={filter}
            isLoading={isLoadingValues}
            isError={erroredFilterIds?.has(filter.id) ?? false}
            errorMessage={filterErrorMessages?.get(filter.id)}
            pendingVariables={pendingVariables}
            onChange={values => onSetFilterValue(filter.id, values)}
            values={queriedFilterValues?.values}
            value={selectedValues}
          />
        );
      })}
      {linkableFiltersCount >= 2 && (
        <Stack gap={2} justify="flex-end">
          {/* Spacer to align the toggle with the inputs (filters have a label row above). */}
          <Text size="xs" c="transparent" aria-hidden>
            &nbsp;
          </Text>
          <FilterLinkToggle
            linked={linked}
            onChange={setLinked}
            showVariableNote={variables !== undefined}
            data-testid="dashboard-filters-link-toggle"
          />
        </Stack>
      )}
      {isFetching && <IconRefresh className="spin-animate" size={12} />}
    </Group>
  );
};

export default DashboardFilters;
