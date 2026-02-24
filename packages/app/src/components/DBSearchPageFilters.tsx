import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import cx from 'classnames';
import {
  TableMetadata,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
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
  NumberInput,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChartBar,
  IconChartBarOff,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconFilterOff,
  IconPin,
  IconPinFilled,
  IconRefresh,
  IconSearch,
  IconShadow,
  IconSitemap,
} from '@tabler/icons-react';

import { IS_CLICKHOUSE_BUILD } from '@/config';
import {
  useAllFields,
  useColumns,
  useGetKeyValues,
  useGetValuesDistribution,
  useJsonColumns,
  useTableMetadata,
} from '@/hooks/useMetadata';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import useResizable from '@/hooks/useResizable';
import {
  FilterStateHook,
  IS_ROOT_SPAN_COLUMN_NAME,
  usePinnedFilters,
} from '@/searchFilters';
import { useSource } from '@/source';
import { mergePath } from '@/utils';

import { NestedFilterGroup } from './DBSearchPageFilters/NestedFilterGroup';
import { groupFacetsByBaseName } from './DBSearchPageFilters/utils';

import resizeStyles from '../../styles/ResizablePanel.module.scss';
import classes from '../../styles/SearchPage.module.scss';

/* The initial number of values per filter to load */
const INITIAL_LOAD_LIMIT = 20;

/* The maximum number of values per filter to load when "Load More" is clicked */
const LOAD_MORE_LOAD_LIMIT = 10000;

/* The initial number of values per filter to render */
const INITIAL_MAX_VALUES_DISPLAYED = 10;

/* The maximum number of values per filter to render at once after loading more */
const SHOW_MORE_MAX_VALUES_DISPLAYED = 50;

// This function will clean json string attributes specifically. It will turn a string like
// 'toString(ResourceAttributes.`hdx`.`sdk`.`version`)' into 'ResourceAttributes.hdx.sdk.version'.
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
      >
        <Checkbox
          checked={!!value}
          size={13 as any}
          onChange={() => {
            // taken care by the onClick in the group
          }}
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
            pe={'4px'}
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
              {label || <span className="fst-italic">(empty)</span>}
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
        <ActionIcon
          onClick={onClickPin}
          size="xs"
          variant="subtle"
          color="gray"
          aria-label={pinned ? 'Unpin field' : 'Pin field'}
          role="checkbox"
          aria-checked={pinned}
          data-testid={`filter-pin-${label}`}
        >
          {pinned ? <IconPinFilled size={12} /> : <IconPin size={12} />}
        </ActionIcon>
      </div>
      {pinned && (
        <Center me="1px">
          <IconPinFilled size={12} data-testid={`filter-pin-${label}-pinned`} />
        </Center>
      )}
    </div>
  );
};

const FilterRangeDisplay = ({
  range,
  onRangeChange,
}: {
  name: string;
  range: { min: number; max: number };
  onClearClick: VoidFunction;
  onRangeChange?: (range: { min: number; max: number }) => void;
}) => {
  const [localMin, setLocalMin] = useState(range.min);
  const [localMax, setLocalMax] = useState(range.max);

  const handleMinChange = (value: number | string) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (!isNaN(numValue)) {
      setLocalMin(numValue);
      if (onRangeChange) {
        onRangeChange({ min: numValue, max: localMax });
      }
    }
  };

  const handleMaxChange = (value: number | string) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (!isNaN(numValue)) {
      setLocalMax(numValue);
      if (onRangeChange) {
        onRangeChange({ min: localMin, max: numValue });
      }
    }
  };

  return (
    <Stack gap={8} px="xs" mb="xs">
      <Group gap={4} wrap="nowrap">
        <NumberInput
          size="xs"
          placeholder="Min"
          value={localMin}
          onChange={handleMinChange}
          styles={{ input: { fontSize: '11px' } }}
          flex={1}
          hideControls
        />
        <Text size="xs" c="dimmed">
          to
        </Text>
        <NumberInput
          size="xs"
          placeholder="Max"
          value={localMax}
          onChange={handleMaxChange}
          styles={{ input: { fontSize: '11px' } }}
          flex={1}
          hideControls
        />
      </Group>
    </Stack>
  );
};

export type FilterGroupProps = {
  name: string;
  options: { value: string | boolean; label: string }[];
  optionsLoading?: boolean;
  selectedValues?: {
    included: Set<string | boolean>;
    excluded: Set<string | boolean>;
    range?: { min: number; max: number };
  };
  onChange: (value: string | boolean) => void;
  onClearClick: VoidFunction;
  onOnlyClick: (value: string | boolean) => void;
  onExcludeClick: (value: string | boolean) => void;
  onPinClick: (value: string | boolean) => void;
  isPinned: (value: string | boolean) => boolean;
  onFieldPinClick?: VoidFunction;
  isFieldPinned?: boolean;
  onLoadMore: (key: string) => void;
  loadMoreLoading: boolean;
  hasLoadedMore: boolean;
  isDefaultExpanded?: boolean;
  'data-testid'?: string;
  chartConfig: ChartConfigWithDateRange;
  isLive?: boolean;
  onRangeChange?: (range: { min: number; max: number }) => void;
  distributionKey?: string; // Optional key to use for distribution queries, defaults to name
};

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
  distributionKey,
  onRangeChange,
}: FilterGroupProps) => {
  const [search, setSearch] = useState('');
  // "Show More" button when there's lots of options
  const [shouldShowMore, setShowMore] = useState(false);
  // Accordion expanded state
  const [isExpanded, setExpanded] = useState(isDefaultExpanded ?? false);
  // Track recently moved items for highlight animation
  const [recentlyMoved, setRecentlyMoved] = useState<Set<string | boolean>>(
    new Set(),
  );
  // Show what percentage of the data has each value
  const [showDistributions, setShowDistributions] = useState(false);
  // For live searches, don't refresh percentages when date range changes
  const [dateRange, setDateRange] = useState<[Date, Date]>(
    chartConfig.dateRange,
  );

  // If this filter has a range, display it differently
  const hasRange = selectedValues.range != null;

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

  const handleSetSearch = useCallback(
    (value: string) => {
      setSearch(value);

      if (value && !hasLoadedMore) {
        onLoadMore(name);
      }
    },
    [hasLoadedMore, name, onLoadMore],
  );

  const {
    data: distributionData,
    isFetching: isFetchingDistribution,
    error: distributionError,
  } = useGetValuesDistribution(
    {
      chartConfig: { ...chartConfig, dateRange },
      key: distributionKey || name,
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

  const totalAppliedFiltersSize =
    selectedValues.included.size +
    selectedValues.excluded.size +
    (hasRange ? 1 : 0);

  // Loaded options + any selected options that aren't in the loaded list
  const augmentedOptions = useMemo(() => {
    const selectedSet = new Set([
      ...selectedValues.included,
      ...selectedValues.excluded,
    ]);
    return [
      ...Array.from(selectedSet)
        .filter(value => !options.find(option => option.value === value))
        .map(value => ({ value, label: value.toString() })),
      ...options,
    ];
  }, [options, selectedValues]);

  const displayedItemLimit = shouldShowMore
    ? SHOW_MORE_MAX_VALUES_DISPLAYED
    : INITIAL_MAX_VALUES_DISPLAYED;

  // Options matching search, sorted appropriately
  const sortedMatchingOptions = useMemo(() => {
    // When searching, sort alphabetically
    if (search) {
      return augmentedOptions
        .filter(option => {
          return (
            option.value &&
            option.label.toLowerCase().includes(search.toLowerCase())
          );
        })
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, undefined, { numeric: true }),
        );
    }

    // When not searching, sort by pinned, selected, distribution, then alphabetically
    return augmentedOptions.toSorted((a, b) => {
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
      const aPercentage = distributionData?.get(a.value.toString()) ?? 0;
      const bPercentage = distributionData?.get(b.value.toString()) ?? 0;
      if (aPercentage !== bPercentage) {
        return bPercentage - aPercentage;
      }

      // Finally sort alphabetically/numerically
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  }, [
    search,
    augmentedOptions,
    isPinned,
    selectedValues.included,
    selectedValues.excluded,
    distributionData,
  ]);

  // The subset of options to be displayed
  const displayedOptions = useMemo(() => {
    return sortedMatchingOptions.length <= displayedItemLimit
      ? sortedMatchingOptions
      : sortedMatchingOptions.slice(0, displayedItemLimit);
  }, [sortedMatchingOptions, displayedItemLimit]);

  // Simple highlight animation when checkbox is checked
  const handleChange = useCallback(
    (value: string | boolean) => {
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

  const isLimitingDisplayedItems =
    sortedMatchingOptions.length > displayedOptions.length;

  const showShowMoreButton =
    !search &&
    augmentedOptions.length > INITIAL_MAX_VALUES_DISPLAYED &&
    totalAppliedFiltersSize < augmentedOptions.length;

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
              pr="xxxs"
              data-testid="filter-group-control"
              style={{ overflow: 'hidden' }}
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
                <Text size="xs" fw="500" truncate="end">
                  {name}
                </Text>
              </Tooltip>
            </Accordion.Control>
            <Group gap={0} wrap="nowrap">
              {!hasRange && (
                <>
                  <Tooltip
                    label={
                      showDistributions
                        ? 'Hide Distribution'
                        : 'Show Distribution'
                    }
                    position="top"
                    withArrow
                    fz="xxs"
                    color="gray"
                  >
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={toggleShowDistributions}
                      data-testid={`toggle-distribution-button-${name}`}
                      aria-checked={showDistributions}
                      role="checkbox"
                    >
                      {isFetchingDistribution ? (
                        <Center>
                          <IconRefresh className="spin-animate" size={12} />
                        </Center>
                      ) : showDistributions ? (
                        <IconChartBarOff size={14} />
                      ) : (
                        <IconChartBar size={14} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                  {onFieldPinClick && (
                    <Tooltip
                      label={isFieldPinned ? 'Unpin Field' : 'Pin Field'}
                      position="top"
                      withArrow
                      fz="xxs"
                      color="gray"
                    >
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="gray"
                        onClick={onFieldPinClick}
                      >
                        {isFieldPinned ? (
                          <IconPinFilled size={14} />
                        ) : (
                          <IconPin size={14} />
                        )}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </>
              )}
              {totalAppliedFiltersSize > 0 && (
                <Tooltip
                  label="Clear Filters"
                  position="top"
                  withArrow
                  fz="xxs"
                  color="gray"
                >
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => {
                      onClearClick();
                      setSearch('');
                    }}
                  >
                    <IconFilterOff size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Center>
          <Accordion.Panel
            data-testid="filter-group-panel"
            classNames={{
              content: 'p-0 pt-2',
            }}
          >
            {hasRange && selectedValues.range ? (
              <FilterRangeDisplay
                name={name}
                range={selectedValues.range}
                onClearClick={onClearClick}
                onRangeChange={onRangeChange}
              />
            ) : (
              <Stack gap={0}>
                {/* Show search bar if expanded and there are more than 5 values */}
                {isExpanded && augmentedOptions.length > 5 && (
                  <div className="px-2 pb-2">
                    <TextInput
                      size="xs"
                      placeholder="Search values..."
                      value={search}
                      data-testid={`filter-search-${name}`}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        handleSetSearch(event.currentTarget.value)
                      }
                      rightSectionWidth={20}
                      rightSection={<IconSearch size={12} stroke={2} />}
                      classNames={{
                        input: 'ps-0.5',
                      }}
                    />
                  </div>
                )}
                {displayedOptions.map(option => (
                  <FilterCheckbox
                    key={option.value.toString()}
                    label={option.label}
                    pinned={isPinned(option.value)}
                    className={
                      recentlyMoved.has(option.value)
                        ? classes.recentlyMoved
                        : ''
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
                        ? (distributionData.get(option.value.toString()) ?? 0)
                        : undefined
                    }
                  />
                ))}
                {optionsLoading ? (
                  <Group m={6} gap="xs">
                    <Loader size={12} color="gray" />
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
                {isLimitingDisplayedItems && (shouldShowMore || search) && (
                  <Text size="xxs" ms={28} fs="italic">
                    Search to see more
                  </Text>
                )}
                {loadMoreLoading && (
                  <Group m={6} gap="xs">
                    <Loader size={12} color="gray" />
                    <Text c="dimmed" size="xs">
                      Loading more...
                    </Text>
                  </Group>
                )}
                {showShowMoreButton && (
                  <div className="d-flex m-1">
                    <TextButton
                      data-testid={`filter-show-more-${name}`}
                      label={
                        shouldShowMore ? (
                          <>
                            <IconChevronUp size={12} /> Less
                          </>
                        ) : (
                          <>
                            <IconChevronRight size={12} /> Show more
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
                  !hasLoadedMore &&
                  !loadMoreLoading && (
                    <div className="d-flex m-1">
                      <TextButton
                        data-testid={`filter-load-more-${name}`}
                        display={hasLoadedMore ? 'none' : undefined}
                        label={
                          <>
                            <IconChevronRight size={12} /> Load more
                          </>
                        }
                        onClick={() => onLoadMore(name)}
                      />
                    </div>
                  )}
              </Stack>
            )}
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
  setFilterRange,
}: {
  analysisMode: 'results' | 'delta' | 'pattern';
  setAnalysisMode: (mode: 'results' | 'delta' | 'pattern') => void;
  isLive: boolean;
  chartConfig: ChartConfigWithDateRange;
  sourceId?: string;
  showDelta: boolean;
  denoiseResults: boolean;
  setDenoiseResults: (denoiseResults: boolean) => void;
  setFilterRange: (key: string, range: { min: number; max: number }) => void;
} & FilterStateHook) => {
  const setFilterValue = useCallback(
    (
      property: string,
      value: string | boolean,
      action?: 'only' | 'exclude' | 'include' | undefined,
    ) => {
      return _setFilterValue(property, value, action);
    },
    [_setFilterValue],
  );
  const {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    getPinnedFields,
    pinnedFilters,
  } = usePinnedFilters(sourceId ?? null);
  const { size, startResize } = useResizable(16, 'left');

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
  const { data: columns } = useColumns({
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

  // Clear extra facets (from "load more") when switching sources
  useEffect(() => {
    setExtraFacets({});
  }, [sourceId]);

  const showRefreshButton = isLive && dateRange !== chartConfig.dateRange;

  const {
    data: facets,
    isLoading: isFacetsLoading,
    isFetching: isFacetsFetching,
  } = useGetKeyValues({
    chartConfig: { ...chartConfig, dateRange },
    limit: INITIAL_LOAD_LIMIT,
    keys: keysToFetch,
  });

  // Merge pinned filter values into the queried facets, so that pinned values are always available
  const facetsWithPinnedValues = useMemo(() => {
    const facetsMap = new Map((facets ?? []).map(f => [f.key, f.value]));
    const mergedKeys = new Set<string>([
      ...facetsMap.keys(),
      ...Object.keys(pinnedFilters),
      ...getPinnedFields(),
    ]);

    return Array.from(mergedKeys).map(key => {
      const queriedValues = facetsMap.get(key);
      const pinnedValues = pinnedFilters[key];
      const mergedValues = new Set<string | boolean>([
        ...(queriedValues ?? []),
        ...(pinnedValues ?? []),
      ]);

      return { key, value: Array.from(mergedValues) };
    });
  }, [facets, pinnedFilters, getPinnedFields]);

  const metadata = useMetadataWithSettings();
  const [extraFacets, setExtraFacets] = useState<Record<string, string[]>>({});
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const loadMoreFilterValuesForKey = useCallback(
    async (key: string) => {
      setLoadMoreLoadingKeys(prev => new Set(prev).add(key));
      try {
        const newKeyVals = await metadata.getKeyValuesWithMVs({
          chartConfig: {
            ...chartConfig,
            dateRange,
          },
          keys: [key],
          limit: LOAD_MORE_LOAD_LIMIT,
          disableRowLimit: true,
          source,
        });
        const newValues = newKeyVals[0].value?.map(val => val.toString()) ?? [];
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
    [chartConfig, setExtraFacets, dateRange, metadata, source],
  );

  const shownFacets = useMemo(() => {
    const _facets: { key: string; value: (string | boolean)[] }[] = [];
    for (const _facet of facetsWithPinnedValues ?? []) {
      const facet = structuredClone(_facet);
      if (jsonColumns?.some(col => facet.key.startsWith(col))) {
        facet.key = `toString(${facet.key})`;
      }

      // don't include empty facets, unless they are already selected or pinned
      const filter = filterState[facet.key];
      const hasSelectedValues =
        filter && (filter.included.size > 0 || filter.excluded.size > 0);
      const isPinned = isFieldPinned(facet.key);
      if (facet.value?.length > 0 || hasSelectedValues || isPinned) {
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
      _facets.push({
        key,
        value: Array.from(filterState[key].included),
      });
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

    // prioritize facets that have a range
    _facets.sort((a, b) => {
      const aRange = filterState?.[a.key]?.range;
      const bRange = filterState?.[b.key]?.range;
      if (aRange && !bRange) return -1;
      if (!aRange && bRange) return 1;
      return 0;
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
        f => f.included.size > 0 || f.excluded.size > 0 || f.range != null,
      ),
    [filterState],
  );

  const setRootSpansOnly = useCallback(
    (rootSpansOnly: boolean) => {
      if (!source?.parentSpanIdExpression) return;

      if (rootSpansOnly) {
        if (columns?.some(col => col.name === IS_ROOT_SPAN_COLUMN_NAME)) {
          setFilterValue(IS_ROOT_SPAN_COLUMN_NAME, true, 'only');
        } else {
          setFilterValue(source.parentSpanIdExpression, '', 'only');
        }
      } else {
        clearFilter(source.parentSpanIdExpression);
        clearFilter(IS_ROOT_SPAN_COLUMN_NAME);
      }
    },
    [setFilterValue, clearFilter, source, columns],
  );

  const isRootSpansOnly = useMemo(() => {
    if (!source?.parentSpanIdExpression || source.kind !== SourceKind.Trace)
      return false;

    const parentSpanIdFilter = filterState?.[source?.parentSpanIdExpression];
    const isRootSpanFilter = filterState?.[IS_ROOT_SPAN_COLUMN_NAME];
    return (
      (parentSpanIdFilter?.included.size === 1 &&
        parentSpanIdFilter?.included.has('')) ||
      (isRootSpanFilter?.included.size === 1 &&
        isRootSpanFilter?.included.has(true))
    );
  }, [filterState, source]);

  return (
    <Box className={classes.filtersPanel} style={{ width: `${size}%` }}>
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
              {!IS_CLICKHOUSE_BUILD && (
                <Tabs.Tab value="pattern" size="xs" h="24px">
                  <Text size="xs">Event Patterns</Text>
                </Tabs.Tab>
              )}
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
                    <IconRefresh
                      size={14}
                      className="ms-1"
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
                  <Text size="xs" mt="-2px" component="div">
                    <Group gap={2}>
                      <IconShadow
                        size={14}
                        style={{ display: 'inline', verticalAlign: 'middle' }}
                      />
                      Denoise Results
                    </Group>
                  </Text>
                </Tooltip>
              }
              onChange={() => setDenoiseResults(!denoiseResults)}
            />
          )}

          {source?.kind === SourceKind.Trace &&
            source.parentSpanIdExpression && (
              <Checkbox
                size={13 as any}
                checked={isRootSpansOnly}
                ms="6px"
                label={
                  <Tooltip
                    openDelay={200}
                    color="gray"
                    position="right"
                    withArrow
                    label="Only show root spans (spans with no parent span)."
                  >
                    <Text size="xs" mt="-2px" component="div">
                      <Group gap={2}>
                        <IconSitemap
                          size={14}
                          style={{ display: 'inline', verticalAlign: 'middle' }}
                        />
                        Root Spans Only
                      </Group>
                    </Text>
                  </Tooltip>
                }
                onChange={event => setRootSpansOnly(event.target.checked)}
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
          {(() => {
            const { grouped, nonGrouped } = groupFacetsByBaseName(shownFacets);

            return (
              <>
                {/* Render grouped facets as nested filter groups */}
                {grouped.map(group => (
                  <NestedFilterGroup
                    key={group.key}
                    data-testid={`nested-filter-group-${group.key}`}
                    name={group.key}
                    childFilters={group.children}
                    selectedValues={group.children.reduce(
                      (acc, child) => {
                        acc[child.key] = filterState[child.key]
                          ? filterState[child.key]
                          : { included: new Set(), excluded: new Set() };
                        return acc;
                      },
                      {} as Record<
                        string,
                        {
                          included: Set<string | boolean>;
                          excluded: Set<string | boolean>;
                        }
                      >,
                    )}
                    onChange={(key, value) => {
                      setFilterValue(key, value);
                    }}
                    onClearClick={key => clearFilter(key)}
                    onOnlyClick={(key, value) => {
                      setFilterValue(key, value, 'only');
                    }}
                    onExcludeClick={(key, value) => {
                      setFilterValue(key, value, 'exclude');
                    }}
                    onPinClick={(key, value) => toggleFilterPin(key, value)}
                    isPinned={(key, value) => isFilterPinned(key, value)}
                    onFieldPinClick={key => toggleFieldPin(key)}
                    isFieldPinned={key => isFieldPinned(key)}
                    onLoadMore={loadMoreFilterValuesForKey}
                    loadMoreLoading={group.children.reduce(
                      (acc, child) => {
                        acc[child.key] = loadMoreLoadingKeys.has(child.key);
                        return acc;
                      },
                      {} as Record<string, boolean>,
                    )}
                    hasLoadedMore={group.children.reduce(
                      (acc, child) => {
                        acc[child.key] = Boolean(extraFacets[child.key]);
                        return acc;
                      },
                      {} as Record<string, boolean>,
                    )}
                    isDefaultExpanded={
                      // open by default if has selected values or pinned children
                      group.children.some(
                        child =>
                          (filterState[child.key] &&
                            (filterState[child.key].included.size > 0 ||
                              filterState[child.key].excluded.size > 0)) ||
                          isFieldPinned(child.key),
                      )
                    }
                    chartConfig={chartConfig}
                    isLive={isLive}
                  />
                ))}

                {/* Render non-grouped facets as regular filter groups */}
                {nonGrouped.map(facet => (
                  <FilterGroup
                    key={facet.key}
                    data-testid={`filter-group-${facet.key}`}
                    name={cleanedFacetName(facet.key)}
                    options={facet.value.map(value => ({
                      value,
                      label: value.toString(),
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
                          filterState[facet.key].excluded.size > 0 ||
                          filterState[facet.key].range != null))
                    }
                    chartConfig={chartConfig}
                    isLive={isLive}
                    onRangeChange={range => setFilterRange(facet.key, range)}
                  />
                ))}
              </>
            );
          })()}

          <Button
            variant="secondary"
            size="compact-xs"
            loading={isFacetsFetching}
            rightSection={
              showMoreFields ? (
                <IconChevronUp size={14} />
              ) : (
                <IconChevronDown size={14} />
              )
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
