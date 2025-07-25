import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  Loader,
  MantineStyleProps,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import { useExplainQuery } from '@/hooks/useExplainQuery';
import { useAllFields, useGetKeyValues } from '@/hooks/useMetadata';
import useResizable from '@/hooks/useResizable';
import { getMetadata } from '@/metadata';
import { FilterStateHook, usePinnedFilters } from '@/searchFilters';
import { mergePath } from '@/utils';

import resizeStyles from '../../styles/ResizablePanel.module.scss';
import classes from '../../styles/SearchPage.module.scss';

type FilterCheckboxProps = {
  label: string;
  value?: 'included' | 'excluded' | false;
  pinned: boolean;
  onChange?: (checked: boolean) => void;
  onClickOnly?: VoidFunction;
  onClickExclude?: VoidFunction;
  onClickPin: VoidFunction;
};

export const TextButton = ({
  onClick,
  label,
  ms,
  display,
}: {
  onClick?: VoidFunction;
  label: React.ReactNode;
  ms?: MantineStyleProps['ms'];
  display?: MantineStyleProps['display'];
}) => {
  return (
    <UnstyledButton
      display={display}
      onClick={onClick}
      className={classes.textButton}
    >
      <Text size="xxs" c="gray.6" lh={1} ms={ms}>
        {label}
      </Text>
    </UnstyledButton>
  );
};

const emptyFn = () => {};
export const FilterCheckbox = ({
  value,
  label,
  pinned,
  onChange,
  onClickOnly,
  onClickExclude,
  onClickPin,
}: FilterCheckboxProps) => {
  return (
    <div className={classes.filterCheckbox}>
      <Group
        gap={8}
        onClick={() => onChange?.(!value)}
        style={{ minWidth: 0 }}
        wrap="nowrap"
        align="flex-start"
      >
        <Checkbox
          checked={!!value}
          size={13 as any}
          onChange={
            // taken care by the onClick in the group, triggering here will double fire
            emptyFn
          }
          indeterminate={value === 'excluded'}
        />
        <Tooltip
          openDelay={label.length > 22 ? 0 : 1500}
          label={label}
          position="right"
          withArrow
          fz="xxs"
          color="gray"
        >
          <Text
            size="xs"
            c={value === 'excluded' ? 'red.4' : 'gray.3'}
            truncate="end"
            w="100%"
            title={label}
          >
            {label}
          </Text>
        </Tooltip>
      </Group>
      <div className={classes.filterActions}>
        {onClickOnly && <TextButton onClick={onClickOnly} label="Only" />}
        {onClickExclude && (
          <TextButton onClick={onClickExclude} label="Exclude" />
        )}
        <TextButton
          onClick={onClickPin}
          label={<i className={`bi bi-pin-angle${pinned ? '-fill' : ''}`}></i>}
        />
      </div>
      {pinned && (
        <Text size="xxs" c="gray.6">
          <i className="bi bi-pin-angle-fill"></i>
        </Text>
      )}
    </div>
  );
};

export type FilterGroupProps = {
  name: string;
  options: { value: string; label: string }[];
  optionsLoading?: boolean;
  selectedValues?: {
    included: Set<string>;
    excluded: Set<string>;
  };
  onChange: (value: string) => void;
  onClearClick: VoidFunction;
  onOnlyClick: (value: string) => void;
  onExcludeClick: (value: string) => void;
  onPinClick: (value: string) => void;
  isPinned: (value: string) => boolean;
  onFieldPinClick?: VoidFunction;
  isFieldPinned?: boolean;
  onLoadMore: (key: string) => void;
  loadMoreLoading: boolean;
  hasLoadedMore: boolean;
};

const MAX_FILTER_GROUP_ITEMS = 10;

export const FilterGroup = ({
  name,
  options,
  optionsLoading,
  selectedValues = { included: new Set(), excluded: new Set() },
  onChange,
  onClearClick,
  onOnlyClick,
  onExcludeClick,
  isPinned,
  onPinClick,
  onFieldPinClick,
  isFieldPinned,
  onLoadMore,
  loadMoreLoading,
  hasLoadedMore,
}: FilterGroupProps) => {
  const [search, setSearch] = useState('');
  const [isExpanded, setExpanded] = useState(false);

  const augmentedOptions = useMemo(() => {
    const selectedSet = new Set([
      ...selectedValues.included,
      ...selectedValues.excluded,
    ]);
    return [
      ...Array.from(selectedSet)
        .filter(value => !options.find(option => option.value === value))
        .map(value => ({ value, label: value })),
      ...options,
    ];
  }, [options, selectedValues]);

  const displayedOptions = useMemo(() => {
    if (search) {
      return augmentedOptions.filter(option => {
        return (
          option.value &&
          option.value.toLowerCase().includes(search.toLowerCase())
        );
      });
    }

    const sortBySelectionAndAlpha = (
      a: (typeof augmentedOptions)[0],
      b: (typeof augmentedOptions)[0],
    ) => {
      const aPinned = isPinned(a.value);
      const aIncluded = selectedValues.included.has(a.value);
      const aExcluded = selectedValues.excluded.has(a.value);
      const bPinned = isPinned(b.value);
      const bIncluded = selectedValues.included.has(b.value);
      const bExcluded = selectedValues.excluded.has(b.value);

      // First sort by pinned status
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      // Then sort by included status
      if (aIncluded && !bIncluded) return -1;
      if (!aIncluded && bIncluded) return 1;

      // Then sort by excluded status
      if (aExcluded && !bExcluded) return -1;
      if (!aExcluded && bExcluded) return 1;

      // Finally sort alphabetically/numerically
      return a.value.localeCompare(b.value, undefined, { numeric: true });
    };

    // If expanded or small list, sort everything
    if (isExpanded || augmentedOptions.length <= MAX_FILTER_GROUP_ITEMS) {
      return augmentedOptions.sort(sortBySelectionAndAlpha);
    }

    // Do not rearrange items if all selected values are visible without expanding
    return augmentedOptions
      .sort((a, b) => sortBySelectionAndAlpha(a, b))
      .slice(
        0,
        Math.max(
          MAX_FILTER_GROUP_ITEMS,
          selectedValues.included.size + selectedValues.excluded.size,
        ),
      );
  }, [search, isExpanded, augmentedOptions, selectedValues]);

  const showExpandButton =
    !search &&
    augmentedOptions.length > MAX_FILTER_GROUP_ITEMS &&
    selectedValues.included.size + selectedValues.excluded.size <
      augmentedOptions.length;

  return (
    <Stack gap={0}>
      <Tooltip
        openDelay={name.length > 26 ? 0 : 1500}
        label={name}
        position="top"
        withArrow
        fz="xxs"
        color="gray"
      >
        <TextInput
          size="xs"
          placeholder={name}
          value={search}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(event.currentTarget.value)
          }
          leftSectionWidth={27}
          leftSection={<IconSearch size={15} stroke={2} />}
          rightSection={
            <Group gap="xs">
              {onFieldPinClick && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={onFieldPinClick}
                  title={isFieldPinned ? 'Unpin field' : 'Pin field'}
                >
                  <i
                    className={`bi bi-pin-angle${isFieldPinned ? '-fill' : ''}`}
                  />
                </ActionIcon>
              )}
              {selectedValues.included.size + selectedValues.excluded.size >
                0 && (
                <TextButton
                  label="Clear"
                  onClick={() => {
                    onClearClick();
                    setSearch('');
                  }}
                />
              )}
            </Group>
          }
        />
      </Tooltip>
      <Stack gap={0}>
        {displayedOptions.map(option => (
          <FilterCheckbox
            key={option.value}
            label={option.label}
            pinned={isPinned(option.value)}
            value={
              selectedValues.included.has(option.value)
                ? 'included'
                : selectedValues.excluded.has(option.value)
                  ? 'excluded'
                  : false
            }
            onChange={() => onChange(option.value)}
            onClickOnly={() => onOnlyClick(option.value)}
            onClickExclude={() => onExcludeClick(option.value)}
            onClickPin={() => onPinClick(option.value)}
          />
        ))}
        {optionsLoading ? (
          <Group m={6} gap="xs">
            <Loader size={12} color="gray.6" />
            <Text c="dimmed" size="xs">
              Loading...
            </Text>
          </Group>
        ) : displayedOptions.length === 0 ? (
          <Group m={6} gap="xs">
            <Text c="dimmed" size="xs">
              No options found
            </Text>
          </Group>
        ) : null}
        {showExpandButton && (
          <div className="d-flex m-1">
            <TextButton
              label={
                isExpanded ? (
                  <>
                    <span className="bi-chevron-up" /> Less
                  </>
                ) : (
                  <>
                    <span className="bi-chevron-down" /> Show more
                  </>
                )
              }
              onClick={() => setExpanded(!isExpanded)}
            />
          </div>
        )}
        {onLoadMore && (!showExpandButton || isExpanded) && (
          <div className="d-flex m-1">
            {loadMoreLoading ? (
              <Group m={6} gap="xs">
                <Loader size={12} color="gray.6" />
                <Text c="dimmed" size="xs">
                  Loading more...
                </Text>
              </Group>
            ) : (
              <TextButton
                display={hasLoadedMore ? 'none' : undefined}
                label={
                  <>
                    <span className="bi-chevron-down" /> Load more
                  </>
                }
                onClick={() => onLoadMore(name)}
              />
            )}
          </div>
        )}
      </Stack>
    </Stack>
  );
};

const DBSearchPageFiltersComponent = ({
  filters: filterState,
  clearAllFilters,
  clearFilter,
  setFilterValue,
  isLive,
  chartConfig,
  analysisMode,
  setAnalysisMode,
  sourceId,
  showDelta,
  denoiseResults,
  setDenoiseResults,
}: {
  analysisMode: 'results' | 'delta' | 'pattern';
  setAnalysisMode: (mode: 'results' | 'delta' | 'pattern') => void;
  isLive: boolean;
  chartConfig: ChartConfigWithDateRange;
  sourceId?: string;
  showDelta: boolean;
  denoiseResults: boolean;
  setDenoiseResults: (denoiseResults: boolean) => void;
} & FilterStateHook) => {
  const {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    getPinnedFields,
  } = usePinnedFilters(sourceId ?? null);
  const { width, startResize } = useResizable(16, 'left');

  const { data: countData } = useExplainQuery(chartConfig);
  const numRows: number = countData?.[0]?.rows ?? 0;

  const { data, isLoading } = useAllFields({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });

  const [showMoreFields, setShowMoreFields] = useState(false);

  const keysToFetch = useMemo(() => {
    if (!data) {
      return [];
    }

    const strings = data
      .sort((a, b) => {
        // First show low cardinality fields
        const isLowCardinality = (type: string) =>
          type.includes('LowCardinality');
        return isLowCardinality(a.type) && !isLowCardinality(b.type) ? -1 : 1;
      })
      .filter(
        field => field.jsType && ['string'].includes(field.jsType),
        // todo: add number type with sliders :D
      )
      .map(({ path, type }) => {
        return { type, path: mergePath(path) };
      })
      .filter(
        field =>
          showMoreFields ||
          field.type.includes('LowCardinality') || // query only low cardinality fields by default
          Object.keys(filterState).includes(field.path) || // keep selected fields
          isFieldPinned(field.path), // keep pinned fields
      )
      .map(({ path }) => path)
      .filter(
        path =>
          !['body', 'timestamp', '_hdx_body'].includes(path.toLowerCase()),
      );

    return strings;
  }, [data, filterState, showMoreFields]);

  // Special case for live tail
  const [dateRange, setDateRange] = useState<[Date, Date]>(
    chartConfig.dateRange,
  );

  useEffect(() => {
    if (!isLive) {
      setDateRange(chartConfig.dateRange);
      setExtraFacets({});
    }
  }, [chartConfig.dateRange, isLive]);

  const showRefreshButton = isLive && dateRange !== chartConfig.dateRange;

  const keyLimit = 20;
  const {
    data: facets,
    isLoading: isFacetsLoading,
    isFetching: isFacetsFetching,
  } = useGetKeyValues({
    chartConfigs: { ...chartConfig, dateRange },
    limit: keyLimit,
    keys: keysToFetch,
  });

  const [extraFacets, setExtraFacets] = useState<Record<string, string[]>>({});
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const loadMoreFilterValuesForKey = useCallback(
    async (key: string) => {
      setLoadMoreLoadingKeys(prev => new Set(prev).add(key));
      try {
        const metadata = getMetadata();
        const newKeyVals = await metadata.getKeyValues({
          chartConfig: {
            ...chartConfig,
            dateRange,
          },
          keys: [key],
          limit: 200,
          disableRowLimit: true,
        });
        const newValues = newKeyVals[0].value;
        if (newValues.length > 0) {
          setExtraFacets(prev => ({
            ...prev,
            [key]: [...(prev[key] || []), ...newValues],
          }));
        }
      } catch (error) {
        console.error('failed to fetch more keys', error);
      } finally {
        setLoadMoreLoadingKeys(prev => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
      }
    },
    [chartConfig, setExtraFacets, dateRange],
  );

  const shownFacets = useMemo(() => {
    const _facets: { key: string; value: string[] }[] = [];
    for (const facet of facets ?? []) {
      // don't include empty facets, unless they are already selected
      const filter = filterState[facet.key];
      const hasSelectedValues =
        filter && (filter.included.size > 0 || filter.excluded.size > 0);
      if (facet.value?.length > 0 || hasSelectedValues) {
        const extraValues = extraFacets[facet.key];
        if (extraValues && extraValues.length > 0) {
          const allValues = facet.value.slice();
          for (const extraValue of extraValues) {
            if (!allValues.includes(extraValue)) {
              allValues.push(extraValue);
            }
          }
          _facets.push({
            key: facet.key,
            value: allValues,
          });
        } else {
          _facets.push(facet);
        }
      }
    }
    // get remaining filterState that are not in _facets
    const remainingFilterState = Object.keys(filterState).filter(
      key => !_facets.some(facet => facet.key === key),
    );
    for (const key of remainingFilterState) {
      _facets.push({ key, value: Array.from(filterState[key].included) });
    }

    // Any other keys, let's add them in with empty values
    for (const key of keysToFetch) {
      if (!_facets.some(facet => facet.key === key)) {
        _facets.push({ key, value: [] });
      }
    }

    // reorder facets to put pinned fields first
    _facets.sort((a, b) => {
      const aPinned = isFieldPinned(a.key);
      const bPinned = isFieldPinned(b.key);
      return aPinned && !bPinned ? -1 : bPinned && !aPinned ? 1 : 0;
    });

    return _facets;
  }, [facets, filterState, extraFacets, keysToFetch, isFieldPinned]);

  const showClearAllButton = useMemo(
    () =>
      Object.values(filterState).some(
        f => f.included.size > 0 || f.excluded.size > 0,
      ),
    [filterState],
  );

  return (
    <Box className={classes.filtersPanel} style={{ width: `${width}%` }}>
      <div className={resizeStyles.resizeHandle} onMouseDown={startResize} />
      <ScrollArea
        h="100%"
        scrollbarSize={4}
        scrollbars="y"
        style={{
          display: 'block',
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <Stack gap="sm" p="xs">
          <Text size="xxs" c="dimmed" fw="bold">
            Analysis Mode
          </Text>
          <Tabs
            value={analysisMode}
            onChange={value =>
              setAnalysisMode(value as 'results' | 'delta' | 'pattern')
            }
            orientation="vertical"
            w="100%"
            placement="right"
          >
            <Tabs.List w="100%">
              <Tabs.Tab value="results" size="xs" c="gray.4" h="24px">
                <Text size="xs">Results Table</Text>
              </Tabs.Tab>
              {showDelta && (
                <Tabs.Tab value="delta" size="xs" c="gray.4" h="24px">
                  <Text size="xs">Event Deltas</Text>
                </Tabs.Tab>
              )}
              <Tabs.Tab value="pattern" size="xs" c="gray.4" h="24px">
                <Text size="xs">Event Patterns</Text>
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>

          <Flex align="center" justify="space-between">
            <Flex className={isFacetsFetching ? 'effect-pulse' : ''}>
              <Text size="xxs" c="dimmed" fw="bold">
                Filters {isFacetsFetching && '···'}
              </Text>
              {showRefreshButton && (
                <TextButton
                  label={
                    <i
                      className="bi-arrow-clockwise ms-1 fs-7"
                      onClick={() => setDateRange(chartConfig.dateRange)}
                    />
                  }
                />
              )}
            </Flex>
            {showClearAllButton && (
              <TextButton
                label="Clear all"
                onClick={() => {
                  clearAllFilters();
                }}
              />
            )}
          </Flex>

          {analysisMode === 'results' && (
            <Checkbox
              size={13 as any}
              checked={denoiseResults}
              ms="6px"
              label={
                <Tooltip
                  openDelay={200}
                  color="gray"
                  position="right"
                  withArrow
                  label="Denoise results will visually remove events matching common event patterns from the results table."
                >
                  <Text size="xs" c="gray.3" mt="-1px">
                    <i className="bi bi-noise-reduction"></i> Denoise Results
                  </Text>
                </Tooltip>
              }
              onChange={() => setDenoiseResults(!denoiseResults)}
            />
          )}

          {isLoading || isFacetsLoading ? (
            <Flex align="center" justify="center">
              <Loader size="xs" color="gray" />
            </Flex>
          ) : (
            shownFacets.length === 0 && (
              <Text size="xxs" c="gray.6">
                No filters available
              </Text>
            )
          )}
          {shownFacets.map(facet => (
            <FilterGroup
              key={facet.key}
              name={facet.key}
              options={facet.value.map(value => ({
                value,
                label: value,
              }))}
              optionsLoading={isFacetsLoading}
              selectedValues={
                filterState[facet.key]
                  ? filterState[facet.key]
                  : { included: new Set(), excluded: new Set() }
              }
              onChange={value => {
                setFilterValue(facet.key, value);
              }}
              onClearClick={() => clearFilter(facet.key)}
              onOnlyClick={value => {
                setFilterValue(facet.key, value, 'only');
              }}
              onExcludeClick={value => {
                setFilterValue(facet.key, value, 'exclude');
              }}
              onPinClick={value => toggleFilterPin(facet.key, value)}
              isPinned={value => isFilterPinned(facet.key, value)}
              onFieldPinClick={() => toggleFieldPin(facet.key)}
              isFieldPinned={isFieldPinned(facet.key)}
              onLoadMore={loadMoreFilterValuesForKey}
              loadMoreLoading={loadMoreLoadingKeys.has(facet.key)}
              hasLoadedMore={Boolean(extraFacets[facet.key])}
            />
          ))}

          <Button
            color="gray"
            variant="light"
            size="compact-xs"
            loading={isFacetsFetching}
            rightSection={
              <i className={`bi-chevron-${showMoreFields ? 'up' : 'down'}`} />
            }
            onClick={() => setShowMoreFields(!showMoreFields)}
          >
            {showMoreFields ? 'Less filters' : 'More filters'}
          </Button>
        </Stack>
      </ScrollArea>
    </Box>
  );
};

export const DBSearchPageFilters = memo(DBSearchPageFiltersComponent);
