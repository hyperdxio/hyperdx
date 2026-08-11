import { useMemo } from 'react';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Flex,
  Group,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconArrowBarToLeft, IconFilterOff } from '@tabler/icons-react';

import {
  cleanedFacetName,
  FilterGroup,
} from '@/components/DBSearchPageFilters';
import { useFetchFacets } from '@/components/DBSearchPageFilters/hooks';
import { NestedFilterGroup } from '@/components/DBSearchPageFilters/NestedFilterGroup';
import {
  getFilterStateEntry,
  groupFacetsByBaseName,
  toQuotedClickHouseKeyExpression,
} from '@/components/DBSearchPageFilters/utils';
import { useMultiSourceSlots } from '@/hooks/useMultiSourceSearch';
import useResizable from '@/hooks/useResizable';
import { FilterStateHook } from '@/searchFilters';

import resizeStyles from '@styles/ResizablePanel.module.scss';
import classes from '@styles/SearchPage.module.scss';

export type MultiSourceFilterSpec = {
  source: TSource;
  /** Per-source config carrying connection/from/where/filters/dateRange. */
  config: BuilderChartConfigWithDateRange;
};

// Placeholder for unused hook slots; never fetched (enabled: false).
const STUB_CONFIG: BuilderChartConfigWithDateRange = {
  connection: '',
  from: { databaseName: '', tableName: '' },
  timestampValueExpression: '',
  select: '',
  where: '',
  whereLanguage: 'sql',
  dateRange: [new Date(0), new Date(0)],
};

type FacetSlotState = {
  facets: { key: string; value: string[] }[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
};

/** Slot hook: the full single-source facet pipeline for one selected source. */
function useSourceFacetsSlot(
  spec: MultiSourceFilterSpec | undefined,
  {
    dateRange,
    filterState,
  }: {
    dateRange: [Date, Date];
    filterState: FilterStateHook['filters'];
  },
): FacetSlotState {
  const { data, isLoading, isFetching } = useFetchFacets({
    chartConfig: spec?.config ?? STUB_CONFIG,
    sourceId: spec?.source.id ?? null,
    dateRange,
    // Value lists show everything in range (not narrowed by the current
    // query), matching the sidebar's default "show all values" behavior.
    mode: 'all',
    filterState,
    enabled: spec != null,
  });

  return useMemo(
    () => ({ facets: data.keyValues, isLoading, isFetching }),
    [data.keyValues, isLoading, isFetching],
  );
}

const NOOP = () => {
  /* pins and load-more are single-source affordances; no-op in multi mode */
};
const VALUE_PINS = { onPinClick: NOOP, isPinned: () => false };

/**
 * Multi-source variant of the search filters sidebar: one facet pipeline per
 * selected source, merged by field path with values unioned. Filters apply
 * per source; a source that lacks a filtered column is excluded from the
 * search (surfaced as a chip on the results table).
 *
 * Single-source-only affordances (pins, shared filters, value counts,
 * load-more, analysis-mode tabs, denoising) are intentionally absent.
 */
export default function MultiSourceSearchFilters({
  specs,
  dateRange,
  isLive,
  knownColumns,
  searchFilters,
  onCollapse,
}: {
  specs: MultiSourceFilterSpec[];
  dateRange: [Date, Date];
  isLive: boolean;
  /** Union of the selected sources' top-level column names (for escaping). */
  knownColumns: Set<string>;
  searchFilters: FilterStateHook;
  onCollapse?: () => void;
}) {
  const { size, startResize } = useResizable(16, 'left');
  const {
    filters: filterState,
    setFilterValue,
    clearFilter,
    clearAllFilters,
    setFilterRange,
  } = searchFilters;

  const slots = useMultiSourceSlots(specs, useSourceFacetsSlot, {
    dateRange,
    filterState,
  });

  const isFetching = slots.some(s => s.isFetching);
  const isLoading = slots.some(s => s.isLoading);

  // Merge facets across sources: union values per field path, in first-seen
  // order (the first selected source's ordering wins).
  const mergedFacets = useMemo(() => {
    const byKey = new Map<string, { values: string[]; seen: Set<string> }>();
    for (const slot of slots) {
      for (const facet of slot.facets ?? []) {
        let entry = byKey.get(facet.key);
        if (entry == null) {
          entry = { values: [], seen: new Set() };
          byKey.set(facet.key, entry);
        }
        for (const value of facet.value) {
          if (!entry.seen.has(value)) {
            entry.seen.add(value);
            entry.values.push(value);
          }
        }
      }
    }
    return [...byKey.entries()].map(([key, entry]) => ({
      key,
      value: entry.values,
    }));
  }, [slots]);

  const hasSelections = Object.keys(filterState).length > 0;
  const firstConfig = specs[0]?.config ?? STUB_CONFIG;
  const { grouped, nonGrouped } = useMemo(
    () => groupFacetsByBaseName(mergedFacets),
    [mergedFacets],
  );

  return (
    <Box className={classes.filtersPanel} style={{ width: `${size}%` }}>
      <div className={resizeStyles.resizeHandle} onMouseDown={startResize} />
      <ScrollArea
        h="100%"
        scrollbarSize={4}
        scrollbars="y"
        style={{ display: 'block', width: '100%', overflow: 'hidden' }}
      >
        <Stack gap="sm" p="xs">
          <Flex align="center" justify="space-between">
            <Text
              size="xxs"
              c="dimmed"
              fw="bold"
              className={isFetching ? 'effect-pulse' : ''}
            >
              Filters {isFetching && '···'}
            </Text>
            <Group gap={0} wrap="nowrap">
              {hasSelections && (
                <Tooltip label="Clear filters" position="bottom">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="xs"
                    onClick={clearAllFilters}
                    aria-label="Clear filters"
                  >
                    <IconFilterOff size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              {onCollapse && (
                <Tooltip label="Hide filters" position="bottom">
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    onClick={onCollapse}
                    aria-label="Hide filters"
                  >
                    <IconArrowBarToLeft size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Flex>
          <Text size="xxs" c="dimmed">
            Values across all selected sources. A filter on a field a source
            doesn't have excludes that source from the results.
          </Text>
          {grouped.map(group => (
            <NestedFilterGroup
              key={group.key}
              data-testid={`multi-nested-filter-group-${group.key}`}
              name={group.key}
              childFilters={group.children.map(child => ({
                ...child,
                sqlKey: toQuotedClickHouseKeyExpression(
                  child.key,
                  knownColumns,
                ),
              }))}
              selectedValues={group.children.reduce((acc, child) => {
                acc[child.key] = getFilterStateEntry(
                  filterState,
                  child.key,
                ) ?? {
                  included: new Set(),
                  excluded: new Set(),
                };
                return acc;
              }, {} as FilterState)}
              onChange={(key, value) => setFilterValue(key, value)}
              onClearClick={key => clearFilter(key)}
              onOnlyClick={(key, value) => setFilterValue(key, value, 'only')}
              onExcludeClick={(key, value) =>
                setFilterValue(key, value, 'exclude')
              }
              onPinClick={NOOP}
              isPinned={() => false}
              showFilterCounts={false}
              onLoadMore={NOOP}
              loadMoreLoading={{}}
              hasLoadedMore={{}}
              isDefaultExpanded={group.children.some(child => {
                const entry = getFilterStateEntry(filterState, child.key);
                return (
                  entry != null &&
                  (entry.included.size > 0 || entry.excluded.size > 0)
                );
              })}
              chartConfig={firstConfig}
              isLive={isLive}
            />
          ))}
          {nonGrouped.map(facet => {
            const facetSqlKey = toQuotedClickHouseKeyExpression(
              facet.key,
              knownColumns,
            );
            const entry = getFilterStateEntry(filterState, facet.key);
            return (
              <FilterGroup
                key={facet.key}
                data-testid={`multi-filter-group-${facet.key}`}
                name={cleanedFacetName(facet.key)}
                distributionKey={facetSqlKey}
                showFilterCounts={false}
                options={facet.value.map(value => ({
                  value,
                  label: value.toString(),
                }))}
                optionsLoading={isLoading}
                selectedValues={
                  entry ?? { included: new Set(), excluded: new Set() }
                }
                onChange={value => setFilterValue(facet.key, value)}
                onClearClick={() => clearFilter(facet.key)}
                onOnlyClick={value => setFilterValue(facet.key, value, 'only')}
                onExcludeClick={value =>
                  setFilterValue(facet.key, value, 'exclude')
                }
                valuePins={VALUE_PINS}
                onLoadMore={NOOP}
                loadMoreLoading={false}
                hasLoadedMore={false}
                isDefaultExpanded={
                  entry != null &&
                  (entry.included.size > 0 ||
                    entry.excluded.size > 0 ||
                    entry.range != null)
                }
                chartConfig={firstConfig}
                isLive={isLive}
                onRangeChange={range => setFilterRange(facet.key, range)}
              />
            );
          })}
          {!isLoading && mergedFacets.length === 0 && (
            <Text size="xxs" c="dimmed">
              No filterable fields found.
            </Text>
          )}
        </Stack>
      </ScrollArea>
    </Box>
  );
}
