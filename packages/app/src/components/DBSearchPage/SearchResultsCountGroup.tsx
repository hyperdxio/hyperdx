import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { IconArrowBarToRight } from '@tabler/icons-react';

import SearchTotalCountChart from '@/components/SearchTotalCountChart';

import { QUERY_KEY_PREFIX } from './utils';

type ExpandFiltersButtonProps = {
  onExpand: () => void;
};

function ExpandFiltersButton({ onExpand }: ExpandFiltersButtonProps) {
  return (
    <Tooltip label="Show filters" position="bottom">
      <ActionIcon
        variant="subtle"
        size="xs"
        onClick={onExpand}
        aria-label="Show filters"
      >
        <IconArrowBarToRight size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

type SearchResultsCountGroupProps = {
  isFilterSidebarCollapsed: boolean;
  onExpandFilters: () => void;
  histogramTimeChartConfig: BuilderChartConfigWithDateRange;
  enableParallelQueries?: boolean;
};

export function SearchResultsCountGroup({
  isFilterSidebarCollapsed,
  onExpandFilters,
  histogramTimeChartConfig,
  enableParallelQueries,
}: SearchResultsCountGroupProps) {
  return (
    <Group gap={4} align="center">
      {isFilterSidebarCollapsed && (
        <ExpandFiltersButton onExpand={onExpandFilters} />
      )}
      <SearchTotalCountChart
        config={histogramTimeChartConfig}
        queryKeyPrefix={QUERY_KEY_PREFIX}
        enableParallelQueries={enableParallelQueries}
      />
    </Group>
  );
}
