import { useCallback, useEffect, useMemo, useState } from 'react';
import produce from 'immer';
import {
  Button,
  Checkbox,
  Flex,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';

import { useAllFields, useGetKeyValues } from '@/hooks/useMetadata';
import { ChartConfigWithDateRange } from '@/renderChartConfig';
import { Filter } from '@/renderChartConfig';
import { useSearchPageFilterState } from '@/searchFilters';

import classes from '../../styles/SearchPage.module.scss';

type FilterCheckboxProps = {
  label: string;
  value?: boolean;
  onChange?: (checked: boolean) => void;
  onClickOnly?: VoidFunction;
};

export const TextButton = ({
  onClick,
  label,
}: {
  onClick?: VoidFunction;
  label: React.ReactNode;
}) => {
  return (
    <UnstyledButton onClick={onClick} className={classes.textButton}>
      <Text size="xxs" c="gray.6" lh={1}>
        {label}
      </Text>
    </UnstyledButton>
  );
};

export const FilterCheckbox = ({
  value,
  label,
  onChange,
  onClickOnly,
}: FilterCheckboxProps) => {
  return (
    <div className={classes.filterCheckbox}>
      <Group
        gap={8}
        onClick={() => onChange?.(!value)}
        flex={1}
        wrap="nowrap"
        align="flex-start"
      >
        <Checkbox
          checked={!!value}
          size={13 as any}
          onChange={e => onChange?.(e.currentTarget.checked)}
        />
        <Tooltip
          openDelay={label.length > 22 ? 0 : 1500}
          label={label}
          position="right"
          withArrow
          fz="xxs"
          color="gray"
        >
          <Text size="xs" c="gray.3" truncate="end" maw="150px" title={label}>
            {label}
          </Text>
        </Tooltip>
      </Group>
      {onClickOnly && <TextButton onClick={onClickOnly} label="Only" />}
    </div>
  );
};

type FilterGroupProps = {
  name: string;
  options: { value: string; label: string }[];
  optionsLoading?: boolean;
  selectedValues?: Set<string>;
  onChange: (value: string) => void;
  onClearClick: VoidFunction;
  onOnlyClick: (value: string) => void;
};

const MAX_FILTER_GROUP_ITEMS = 10;

export const FilterGroup = ({
  name,
  options,
  optionsLoading,
  selectedValues = new Set(),
  onChange,
  onClearClick,
  onOnlyClick,
}: FilterGroupProps) => {
  const [search, setSearch] = useState('');
  const [isExpanded, setExpanded] = useState(false);

  const augmentedOptions = useMemo(() => {
    return [
      ...Array.from(selectedValues)
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

    if (isExpanded || augmentedOptions.length <= MAX_FILTER_GROUP_ITEMS) {
      return augmentedOptions;
    }

    // Do not rearrange items if all selected values are visible without expanding
    const shouldSortBySelected =
      isExpanded ||
      augmentedOptions.some(
        (option, index) =>
          selectedValues.has(option.value) && index >= MAX_FILTER_GROUP_ITEMS,
      );

    return augmentedOptions
      .slice()
      .sort((a, b) => {
        if (!shouldSortBySelected) {
          return 0;
        }
        if (selectedValues.has(a.value) && !selectedValues.has(b.value)) {
          return -1;
        }
        if (!selectedValues.has(a.value) && selectedValues.has(b.value)) {
          return 1;
        }
        return 0;
      })
      .slice(0, Math.max(MAX_FILTER_GROUP_ITEMS, selectedValues.size));
  }, [search, isExpanded, augmentedOptions, selectedValues]);

  const showExpandButton =
    !search &&
    augmentedOptions.length > MAX_FILTER_GROUP_ITEMS &&
    selectedValues.size < augmentedOptions.length;

  return (
    <Stack gap={0}>
      <Group justify="space-between" wrap="nowrap">
        <Tooltip
          openDelay={name.length > 26 ? 0 : 1500}
          label={name}
          position="top"
          withArrow
          fz="xxs"
          color="gray"
        >
          <Text
            size="xxs"
            c="gray.3"
            fw="bold"
            truncate="start"
            maw="170px"
            title={name}
          >
            {name}
          </Text>
        </Tooltip>
        {/* <TextInput
          size="xs"
          variant="default"
          placeholder={name}
          leftSection={<span className="bi-search fs-8.5" />}
          value={search}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(event.currentTarget.value)
          }
        /> */}
        {selectedValues.size > 0 && (
          <TextButton
            label="Clear"
            onClick={() => {
              onClearClick();
              setSearch('');
            }}
          />
        )}
      </Group>
      <Stack gap={0}>
        {displayedOptions.map(option => (
          <FilterCheckbox
            key={option.value}
            label={option.label}
            value={selectedValues.has(option.value)}
            onChange={() => onChange(option.value)}
            onClickOnly={() => onOnlyClick(option.value)}
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
      </Stack>
    </Stack>
  );
};

export const DBSearchPageFilters = ({
  isLive,
  filters,
  chartConfig,
  onFilterChange,
  analysisMode,
  setAnalysisMode,
}: {
  analysisMode: 'results' | 'delta' | 'pattern';
  setAnalysisMode: (mode: 'results' | 'delta' | 'pattern') => void;
  isLive: boolean;
  filters: Filter[];
  chartConfig: ChartConfigWithDateRange;
  onFilterChange: (filters: Filter[]) => void;
}) => {
  const { data, isLoading } = useAllFields({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });

  const [showMoreFields, setShowMoreFields] = useState(false);

  const datum = useMemo(() => {
    if (!data) {
      return [];
    }

    const strings = data
      .sort((a, b) => {
        // First show low cardinality fields
        const isLowCardinality = (type: string) =>
          type.includes('LowCardinality');
        return isLowCardinality(a.type) ? -1 : isLowCardinality(b.type) ? 1 : 0;
      })
      .filter(
        field => field.jsType && ['string'].includes(field.jsType),
        // todo: add number type with sliders :D
      )
      // query only low cardinality fields by default
      .filter(field => showMoreFields || field.type.includes('LowCardinality'))
      .map(({ path }) => {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          return key;
        }
        return `${key}['${rest.join("']['")}']`;
      })
      .filter(path => !['Body', 'Timestamp'].includes(path));

    return strings;
  }, [data, showMoreFields]);

  // Special case for live tail
  const [dateRange, setDateRange] = useState<[Date, Date]>(
    chartConfig.dateRange,
  );

  useEffect(() => {
    if (!isLive) {
      setDateRange(chartConfig.dateRange);
    }
  }, [chartConfig.dateRange, isLive]);

  const showRefreshButton = isLive && dateRange !== chartConfig.dateRange;

  const {
    data: facets,
    isLoading: isFacetsLoading,
    isFetching: isFacetsFetching,
  } = useGetKeyValues({
    chartConfig: { ...chartConfig, dateRange },
    keys: datum,
  });

  const {
    filters: filterState,
    setFilterValue,
    clearFilter,
    clearAllFilters,
  } = useSearchPageFilterState({
    searchQuery: filters ?? undefined,
    onFilterChange,
  });

  const shownFacets = useMemo(() => {
    const _facets: { key: string; value: string[] }[] = [];
    for (const facet of facets ?? []) {
      // don't include empty facets, unless they are already selected
      if (facet.value?.length > 0 || filterState[facet.key]?.size > 0) {
        _facets.push(facet);
      }
    }
    return _facets;
  }, [facets, filterState]);

  const showClearAllButton = useMemo(
    () => Object.keys(filterState).length > 0,
    [filterState],
  );

  return (
    <div className={classes.filtersPanel}>
      <ScrollArea
        h="100%"
        scrollbarSize={4}
        scrollbars="y"
        style={{
          display: 'block',
          'max-width': '100%',
          overflow: 'hidden',
        }}
      >
        <Stack gap="sm" p="xs">
          <Text size="xxs" c="dimmed" fw="bold">
            Analysis Mode
          </Text>
          <Tabs
            value={analysisMode}
            onChange={value => setAnalysisMode(value as 'results' | 'delta')}
            orientation="vertical"
            w="100%"
            placement="right"
          >
            <Tabs.List w="100%">
              <Tabs.Tab value="results" size="xs" c="gray.4" h="24px">
                <Text size="xs">Results Table</Text>
              </Tabs.Tab>
              <Tabs.Tab value="delta" size="xs" c="gray.4" h="24px">
                <Text size="xs">Event Deltas</Text>
              </Tabs.Tab>
              {/* <Tabs.Tab value="pattern" size="xs" c="gray.4" h="24px">
                <Text size="xs">Event Patterns</Text>
              </Tabs.Tab> */}
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
              selectedValues={filterState[facet.key] || new Set()}
              onChange={value => {
                setFilterValue(facet.key, value);
              }}
              onClearClick={() => clearFilter(facet.key)}
              onOnlyClick={value => {
                setFilterValue(facet.key, value, true);
              }}
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
    </div>
  );
};
