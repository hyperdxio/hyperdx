import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import cx from 'classnames';
import {
  TableMetadata,
  tcFromChartConfig,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  Accordion,
  ActionIcon,
  Box,
  Button,
  Center,
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
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';

import { useExplainQuery } from '@/hooks/useExplainQuery';
import {
  useAllFields,
  useGetKeyValues,
  useGetValuesDistribution,
  useJsonColumns,
  useTableMetadata,
} from '@/hooks/useMetadata';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import useResizable from '@/hooks/useResizable';
import { FilterStateHook, usePinnedFilters } from '@/searchFilters';
import { useSource } from '@/source';
import { mergePath } from '@/utils';

import resizeStyles from '../../styles/ResizablePanel.module.scss';
import classes from '../../styles/SearchPage.module.scss';

// This function will clean json string attributes specifically. It will turn a string like
// 'toString(ResourceAttributes.`hdx`.`sdk`.`version`)' into 'ResourceAttributes.hdx.sdk.verion'.
export function cleanedFacetName(key: string): string {
  if (key.startsWith('toString')) {
    return key
      .slice('toString('.length, key.length - 1)
      .split('.')
      .map(str =>
        str.startsWith('`') && str.endsWith('`') ? str.slice(1, -1) : str,
      )
      .join('.');
  }
  return key;
}

type FilterCheckboxProps = {
  label: string;
  value?: 'included' | 'excluded' | false;
  pinned: boolean;
  onChange?: (checked: boolean) => void;
  onClickOnly?: VoidFunction;
  onClickExclude?: VoidFunction;
  onClickPin: VoidFunction;
  className?: string;
  percentage?: number;
  isPercentageLoading?: boolean;
};

export const TextButton = ({
  onClick,
  label,
  ms,
  display,
  'data-testid': dataTestId,
}: {
  onClick?: VoidFunction;
  label: React.ReactNode;
  ms?: MantineStyleProps['ms'];
  display?: MantineStyleProps['display'];
  'data-testid'?: string;
}) => {
  return (
    <UnstyledButton
      display={display}
      onClick={onClick}
      className={classes.textButton}
      data-testid={dataTestId}
    >
      <Text size="xxs" lh={1} ms={ms}>
        {label}
      </Text>
    </UnstyledButton>
  );
};

type FilterPercentageProps = {
  percentage: number;
  isLoading?: boolean;
};

const FilterPercentage = ({ percentage, isLoading }: FilterPercentageProps) => {
  const formattedPercentage =
    percentage < 1
      ? `<1%`
      : percentage >= 99.5
        ? `>99%`
        : `~${Math.round(percentage)}%`;

  return (
    <Text size="xs" className={isLoading ? 'effect-pulse' : ''}>
      {formattedPercentage}
    </Text>
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
  className,
  percentage,
  isPercentageLoading,
}: FilterCheckboxProps) => {
  return (
    <div
      className={cx(classes.filterCheckbox, className)}
      data-testid={`filter-checkbox-${label}`}
    >
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
          data-testid={`filter-checkbox-input-${label}`}
        />
        <Tooltip
          openDelay={label.length > 22 ? 0 : 1500}
          label={label}
          position="right"
          withArrow
          fz="xxs"
          color="gray"
        >
          <Group
            w="100%"
            gap="xs"
            wrap="nowrap"
            justify="space-between"
            pe={'11px'}
            miw={0}
          >
            <Text
              size="xs"
              c={
                value === 'excluded'
                  ? 'var(--color-text-danger)'
                  : 'var(--color-text)'
              }
              truncate="end"
              flex={1}
              title={label}
            >
              {label}
            </Text>
            {percentage != null && (
              <FilterPercentage
                percentage={percentage}
                isLoading={isPercentageLoading}
              />
            )}
          </Group>
        </Tooltip>
      </Group>
      <div className={classes.filterActions}>
        {onClickOnly && (
          <TextButton
            onClick={onClickOnly}
            label="Only"
            data-testid={`filter-only-${label}`}
          />
        )}
        {onClickExclude && (
          <TextButton
            onClick={onClickExclude}
            label="Exclude"
            data-testid={`filter-exclude-${label}`}
          />
        )}
        <TextButton
          onClick={onClickPin}
          label={<i className={`bi bi-pin-angle${pinned ? '-fill' : ''}`}></i>}
          data-testid={`filter-pin-${label}`}
        />
      </div>
      {pinned && (
        <Text size="xxs">
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
  isDefaultExpanded?: boolean;
  'data-testid'?: string;
  chartConfig: ChartConfigWithDateRange;
  isLive?: boolean;
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
  isDefaultExpanded,
  'data-testid': dataTestId,
  chartConfig,
  isLive,
}: FilterGroupProps) => {
  const [search, setSearch] = useState('');
  // "Show More" button when there's lots of options
  const [shouldShowMore, setShowMore] = useState(false);
  // Accordion expanded state
  const [isExpanded, setExpanded] = useState(isDefaultExpanded ?? false);
  // Track recently moved items for highlight animation
  const [recentlyMoved, setRecentlyMoved] = useState<Set<string>>(new Set());
  // Show what percentage of the data has each value
  const [showDistributions, setShowDistributions] = useState(false);
  // For live searches, don't refresh percentages when date range changes
  const [dateRange, setDateRange] = useState<[Date, Date]>(
    chartConfig.dateRange,
  );

  const toggleShowDistributions = () => {
    if (!showDistributions) {
      setExpanded(true);
      setDateRange(chartConfig.dateRange);
    }
    setShowDistributions(prev => !prev);
  };

  useEffect(() => {
    if (!isLive) {
      setDateRange(chartConfig.dateRange);
    }
  }, [chartConfig.dateRange, isLive]);

  useEffect(() => {
    if (isDefaultExpanded) {
      setExpanded(true);
    }
  }, [isDefaultExpanded]);

  const {
    data: distributionData,
    isFetching: isFetchingDistribution,
    error: distributionError,
  } = useGetValuesDistribution(
    {
      chartConfig: { ...chartConfig, dateRange },
      key: name,
      limit: 100, // The 100 most common values are enough to find any values that are present in at least 1% of rows
    },
    {
      enabled: showDistributions,
    },
  );

  useEffect(() => {
    if (distributionError) {
      notifications.show({
        color: 'red',
        title: 'Error loading filter distribution',
        message: distributionError?.message,
        autoClose: 5000,
      });
      setShowDistributions(false);
    }
  }, [distributionError]);

  const totalFiltersSize =
    selectedValues.included.size + selectedValues.excluded.size;

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

    // General Sorting of List
    augmentedOptions.sort((a, b) => {
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

      // Then sort by estimated percentage of rows with this value, if available
      const aPercentage = distributionData?.get(a.value) ?? 0;
      const bPercentage = distributionData?.get(b.value) ?? 0;
      if (aPercentage !== bPercentage) {
        return bPercentage - aPercentage;
      }

      // Finally sort alphabetically/numerically
      return a.value.localeCompare(b.value, undefined, { numeric: true });
    });

    // If expanded or small list, return everything
    if (shouldShowMore || augmentedOptions.length <= MAX_FILTER_GROUP_ITEMS) {
      return augmentedOptions;
    }
    // Return the subset of items
    const pageSize = Math.max(MAX_FILTER_GROUP_ITEMS, totalFiltersSize);
    return augmentedOptions.slice(0, pageSize);
  }, [
    search,
    shouldShowMore,
    isPinned,
    augmentedOptions,
    selectedValues,
    totalFiltersSize,
    distributionData,
  ]);

  // Simple highlight animation when checkbox is checked
  const handleChange = useCallback(
    (value: string) => {
      const wasIncluded = selectedValues.included.has(value);

      // If checking (not unchecking), trigger highlight animation
      if (!wasIncluded) {
        setRecentlyMoved(prev => new Set(prev).add(value));
        setTimeout(() => {
          setRecentlyMoved(prev => {
            const newSet = new Set(prev);
            newSet.delete(value);
            return newSet;
          });
        }, 600);
      }

      onChange(value);
    },
    [onChange, selectedValues],
  );
  const showShowMoreButton =
    !search &&
    augmentedOptions.length > MAX_FILTER_GROUP_ITEMS &&
    totalFiltersSize < augmentedOptions.length;

  return (
    <Accordion
      variant="unstyled"
      chevronPosition="left"
      classNames={{ chevron: classes.chevron }}
      value={isExpanded ? name : null}
      onChange={v => {
        setExpanded(v === name);
      }}
    >
      <Accordion.Item value={name} data-testid={dataTestId}>
        <Stack gap={0}>
          <Center>
            <Accordion.Control
              component={UnstyledButton}
              flex="1"
              p="0"
              data-testid="filter-group-control"
              classNames={{
                chevron: 'm-0',
                label: 'p-0',
              }}
              className={displayedOptions.length ? '' : 'opacity-50'}
            >
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
                  flex="1"
                  placeholder={name}
                  value={search}
                  data-testid={`filter-search-${name}`}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setSearch(event.currentTarget.value)
                  }
                  onClick={e => {
                    // Prevent accordion from opening when clicking on the input, unless it's closed.
                    if (isExpanded) {
                      e.stopPropagation();
                    }
                  }}
                  styles={{ input: { transition: 'padding 0.2s' } }}
                  rightSectionWidth={isExpanded ? 20 : 2}
                  rightSection={
                    <IconSearch
                      size={15}
                      stroke={2}
                      className={`${isExpanded ? 'opacity-100' : 'opacity-0'}`}
                      style={{ transition: 'opacity 0.4s 0.2s' }}
                    />
                  }
                  classNames={{
                    input: 'ps-0.5',
                  }}
                />
              </Tooltip>
            </Accordion.Control>
            <Group gap="xxxs" wrap="nowrap">
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={toggleShowDistributions}
                title={
                  showDistributions ? 'Hide distribution' : 'Show distribution'
                }
                data-testid={`toggle-distribution-button-${name}`}
                aria-checked={showDistributions}
                role="checkbox"
              >
                <i
                  className={`bi ${isFetchingDistribution ? 'spinner-border spinner-border-sm' : showDistributions ? 'bi-bar-chart-line-fill' : 'bi-bar-chart-line'}`}
                />
              </ActionIcon>
              {onFieldPinClick && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={onFieldPinClick}
                  title={isFieldPinned ? 'Unpin field' : 'Pin field'}
                  me={'4px'}
                >
                  <i
                    className={`bi bi-pin-angle${isFieldPinned ? '-fill' : ''}`}
                  />
                </ActionIcon>
              )}
              {totalFiltersSize > 0 && (
                <TextButton
                  label="Clear"
                  onClick={() => {
                    onClearClick();
                    setSearch('');
                  }}
                />
              )}
            </Group>
          </Center>
          <Accordion.Panel
            data-testid="filter-group-panel"
            classNames={{
              content: 'p-0 pt-2',
            }}
          >
            <Stack gap={0}>
              {displayedOptions.map(option => (
                <FilterCheckbox
                  key={option.value}
                  label={option.label}
                  pinned={isPinned(option.value)}
                  className={
                    recentlyMoved.has(option.value) ? classes.recentlyMoved : ''
                  }
                  value={
                    selectedValues.included.has(option.value)
                      ? 'included'
                      : selectedValues.excluded.has(option.value)
                        ? 'excluded'
                        : false
                  }
                  onChange={() => handleChange(option.value)}
                  onClickOnly={() => onOnlyClick(option.value)}
                  onClickExclude={() => onExcludeClick(option.value)}
                  onClickPin={() => onPinClick(option.value)}
                  isPercentageLoading={isFetchingDistribution}
                  percentage={
                    showDistributions && distributionData
                      ? (distributionData.get(option.value) ?? 0)
                      : undefined
                  }
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
              {showShowMoreButton && (
                <div className="d-flex m-1">
                  <TextButton
                    label={
                      shouldShowMore ? (
                        <>
                          <span className="bi-chevron-up" /> Less
                        </>
                      ) : (
                        <>
                          <span className="bi-chevron-right" /> Show more
                        </>
                      )
                    }
                    onClick={() => {
                      // When show more is clicked, immediately show all and also fetch more from server.
                      setShowMore(!shouldShowMore);
                      if (!shouldShowMore) {
                        onLoadMore?.(name);
                      }
                    }}
                  />
                </div>
              )}
              {onLoadMore &&
                !showShowMoreButton &&
                !shouldShowMore &&
                !hasLoadedMore && (
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
                            <span className="bi-chevron-right" /> Load more
                          </>
                        }
                        onClick={() => onLoadMore(name)}
                      />
                    )}
                  </div>
                )}
            </Stack>
          </Accordion.Panel>
        </Stack>
      </Accordion.Item>
    </Accordion>
  );
};

const DBSearchPageFiltersComponent = ({
  filters: filterState,
  clearAllFilters,
  clearFilter,
  setFilterValue: _setFilterValue,
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
  const setFilterValue: typeof _setFilterValue = (
    property: string,
    value: string,
    action?: 'only' | 'exclude' | 'include' | undefined,
  ) => {
    return _setFilterValue(property, value, action);
  };
  const {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    pinnedFilters,
  } = usePinnedFilters(sourceId ?? null);
  const { width, startResize } = useResizable(16, 'left');

  const { data: jsonColumns } = useJsonColumns({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });
  const { data, isLoading, error } = useAllFields({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });

  const { data: source } = useSource({ id: sourceId });
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  useEffect(() => {
    if (error) {
      notifications.show({
        color: 'red',
        title: error?.name,
        message: error?.message,
        autoClose: 5000,
      });
    }
  }, [error]);

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
        return { type, path: mergePath(path, jsonColumns ?? []) };
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
  }, [data, jsonColumns, filterState, showMoreFields, isFieldPinned]);

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
    chartConfig: { ...chartConfig, dateRange },
    limit: keyLimit,
    keys: keysToFetch,
  });

  // Merge pinned filter values into the queried facets, so that pinned values are always available
  const facetsWithPinnedValues = useMemo(() => {
    const facetsMap = new Map((facets ?? []).map(f => [f.key, f.value]));
    const mergedKeys = new Set<string>([
      ...facetsMap.keys(),
      ...Object.keys(pinnedFilters),
    ]);

    return Array.from(mergedKeys).map(key => {
      const queriedValues = facetsMap.get(key);
      const pinnedValues = pinnedFilters[key];
      const mergedValues = new Set<string>([
        ...(queriedValues ?? []),
        ...(pinnedValues ?? []),
      ]);

      return { key, value: Array.from(mergedValues) };
    });
  }, [facets, pinnedFilters]);

  const metadata = useMetadataWithSettings();
  const [extraFacets, setExtraFacets] = useState<Record<string, string[]>>({});
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const loadMoreFilterValuesForKey = useCallback(
    async (key: string) => {
      setLoadMoreLoadingKeys(prev => new Set(prev).add(key));
      try {
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
    for (const _facet of facetsWithPinnedValues ?? []) {
      const facet = structuredClone(_facet);
      if (jsonColumns?.some(col => facet.key.startsWith(col))) {
        facet.key = `toString(${facet.key})`;
      }

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

    // prioritize facets that are primary keys
    _facets.sort((a, b) => {
      const aIsPk = isFieldPrimary(tableMetadata, a.key);
      const bIsPk = isFieldPrimary(tableMetadata, b.key);
      return aIsPk && !bIsPk ? -1 : bIsPk && !aIsPk ? 1 : 0;
    });

    // prioritize facets that are pinned
    _facets.sort((a, b) => {
      const aPinned = isFieldPinned(a.key);
      const bPinned = isFieldPinned(b.key);
      return aPinned && !bPinned ? -1 : bPinned && !aPinned ? 1 : 0;
    });

    // prioritize facets that have checked items
    _facets.sort((a, b) => {
      const aChecked = filterState?.[a.key]?.included.size > 0;
      const bChecked = filterState?.[b.key]?.included.size > 0;
      return aChecked && !bChecked ? -1 : bChecked && !aChecked ? 1 : 0;
    });

    return _facets;
  }, [
    facetsWithPinnedValues,
    filterState,
    tableMetadata,
    extraFacets,
    isFieldPinned,
    jsonColumns,
  ]);

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
              <Tabs.Tab value="results" size="xs" h="24px">
                <Text size="xs">Results Table</Text>
              </Tabs.Tab>
              {showDelta && (
                <Tabs.Tab value="delta" size="xs" h="24px">
                  <Text size="xs">Event Deltas</Text>
                </Tabs.Tab>
              )}
              <Tabs.Tab value="pattern" size="xs" h="24px">
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
                  <Text size="xs" mt="-1px">
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
              <Text size="xxs">No filters available</Text>
            )
          )}
          {/* Show facets even when loading to ensure pinned filters are visible while loading */}
          {shownFacets.map(facet => (
            <FilterGroup
              key={facet.key}
              data-testid={`filter-group-${facet.key}`}
              name={cleanedFacetName(facet.key)}
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
              isDefaultExpanded={
                // open by default if PK, or has selected values
                isFieldPrimary(tableMetadata, facet.key) ||
                isFieldPinned(facet.key) ||
                (filterState[facet.key] &&
                  (filterState[facet.key].included.size > 0 ||
                    filterState[facet.key].excluded.size > 0))
              }
              chartConfig={chartConfig}
              isLive={isLive}
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

          {showMoreFields && (
            <div>
              <Text size="xs" fw="bold">
                Not seeing a filter?
              </Text>
              <Text size="xxs">
                {`Try searching instead (e.g. column:foo)`}
              </Text>
            </div>
          )}
        </Stack>
      </ScrollArea>
    </Box>
  );
};

export function isFieldPrimary(
  tableMetadata: TableMetadata | undefined,
  key: string,
) {
  return tableMetadata?.primary_key?.includes(key);
}
export const DBSearchPageFilters = memo(DBSearchPageFiltersComponent);
