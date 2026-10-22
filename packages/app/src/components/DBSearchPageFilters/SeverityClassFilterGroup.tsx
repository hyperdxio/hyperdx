import { SEVERITY_CLASS_FACET_VALUES } from '@hyperdx/common-utils/dist/core/severity';
import type { FilterState } from '@hyperdx/common-utils/dist/filters';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { FilterGroup } from '@/components/DBSearchPageFilters';
import { SEVERITY_CLASS_FACET_NAME } from '@/components/DBSearchPageFilters/utils';
import type { FilterStateHook } from '@/searchFilters';

const OPTIONS = SEVERITY_CLASS_FACET_VALUES.map(value => ({
  value,
  label: value,
}));

const noop = () => {};

/** The Severity facet: fixed class options, so it runs no values query. */
export function SeverityClassFilterGroup({
  classKey,
  filterState,
  setFilterValue,
  clearFilter,
  chartConfig,
  isLive,
  showFilterCounts,
}: {
  classKey: string;
  filterState: FilterState;
  setFilterValue: FilterStateHook['setFilterValue'];
  clearFilter: FilterStateHook['clearFilter'];
  chartConfig: BuilderChartConfigWithDateRange;
  isLive?: boolean;
  showFilterCounts?: boolean;
}) {
  const selectedValues = filterState[classKey];
  const hasSelection =
    selectedValues != null &&
    (selectedValues.included.size > 0 || selectedValues.excluded.size > 0);

  return (
    <FilterGroup
      name={SEVERITY_CLASS_FACET_NAME}
      data-testid={`filter-group-${SEVERITY_CLASS_FACET_NAME}`}
      distributionKey={classKey}
      fixedOptions
      options={OPTIONS}
      showFilterCounts={showFilterCounts}
      selectedValues={selectedValues}
      onChange={value => setFilterValue(classKey, value)}
      onClearClick={() => clearFilter(classKey)}
      onOnlyClick={value => setFilterValue(classKey, value, 'only')}
      onExcludeClick={value => setFilterValue(classKey, value, 'exclude')}
      onLoadMore={noop}
      loadMoreLoading={false}
      hasLoadedMore
      isDefaultExpanded={hasSelection}
      chartConfig={chartConfig}
      isLive={isLive}
    />
  );
}
