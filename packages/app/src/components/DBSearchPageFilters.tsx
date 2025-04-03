import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import objectHash from 'object-hash';
import {
  ChartConfigWithDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';
import {
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

import { useAllFields, useGetKeyValues } from '@/hooks/useMetadata';
import useResizable from '@/hooks/useResizable';
import { useSearchPageFilterState } from '@/searchFilters';
import { mergePath, useLocalStorage } from '@/utils';

import resizeStyles from '../../styles/ResizablePanel.module.scss';
import classes from '../../styles/SearchPage.module.scss';

type FilterCheckboxProps = {
  label: string;
  value?: 'included' | 'excluded' | false;
  onChange?: (checked: boolean) => void;
  onClickOnly?: VoidFunction;
  onClickExclude?: VoidFunction;
};

export const TextButton = ({
  onClick,
  label,
  ms,
}: {
  onClick?: VoidFunction;
  label: React.ReactNode;
  ms?: MantineStyleProps['ms'];
}) => {
  return (
    <UnstyledButton onClick={onClick} className={classes.textButton}>
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
  onChange,
  onClickOnly,
  onClickExclude,
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
      </div>
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
      const aIncluded = selectedValues.included.has(a.value);
      const aExcluded = selectedValues.excluded.has(a.value);
      const bIncluded = selectedValues.included.has(b.value);
      const bExcluded = selectedValues.excluded.has(b.value);

      // First sort by included status
      if (aIncluded && !bIncluded) return -1;
      if (!aIncluded && bIncluded) return 1;

      // Then sort by excluded status
      if (aExcluded && !bExcluded) return -1;
      if (!aExcluded && bExcluded) return 1;

      // Finally sort alphabetically
      return a.value.localeCompare(b.value);
    };

    // If expanded or small list, sort everything
    if (isExpanded || augmentedOptions.length <= MAX_FILTER_GROUP_ITEMS) {
      return augmentedOptions.sort(sortBySelectionAndAlpha);
    }

    // Do not rearrange items if all selected values are visible without expanding
    const shouldSortBySelected =
      isExpanded ||
      augmentedOptions.some(
        (option, index) =>
          (selectedValues.included.has(option.value) ||
            selectedValues.excluded.has(option.value)) &&
          index >= MAX_FILTER_GROUP_ITEMS,
      );

    return augmentedOptions
      .slice()
      .sort((a, b) =>
        shouldSortBySelected
          ? sortBySelectionAndAlpha(a, b)
          : a.value.localeCompare(b.value),
      )
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
            selectedValues.included.size + selectedValues.excluded.size > 0 ? (
              <TextButton
                ms="xs"
                label="Clear"
                onClick={() => {
                  onClearClick();
                  setSearch('');
                }}
              />
            ) : null
          }
        />
      </Tooltip>
      <Stack gap={0}>
        {displayedOptions.map(option => (
          <FilterCheckbox
            key={option.value}
            label={option.label}
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

type SavedFilters = {
  [key: string]: Filter[];
};

function SaveFilterInput() {
  const [savedFilters, setSavedFilters] = useLocalStorage<SavedFilters>(
    'hdx-saved-search-filters',
    {},
  );
  const [queryFilters] = useQueryState<Filter[]>(
    'filters',
    parseAsJson<Filter[]>(),
  );
  const [newFilterName, setNewFilterName] = useState('');
  const [showButton, setShowButton] = useState(true);
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    setNewFilterName(e.target.value);
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryFilters) return;
    const tmp = savedFilters;
    tmp[newFilterName] = queryFilters;
    setSavedFilters(tmp);
  };

  return (
    <Flex pl="xs" py="xxs" mb="xs" className={classes.filterCheckbox}>
      {showButton ? (
        <UnstyledButton
          onClick={() => setShowButton(false)}
          className={classes.textButton}
          style={{ width: '100%' }}
        >
          <Text size="xs" c="gray.6" lh={1}>
            <b>+ Save Filter</b>
          </Text>
        </UnstyledButton>
      ) : (
        <form onSubmit={handleSubmit}>
          <TextInput
            autoFocus
            onBlur={() => setShowButton(true)}
            placeholder="New Filter"
            onChange={handleChange}
            name="newFilterName"
          />
        </form>
      )}
    </Flex>
  );
}

export function SavedFilters() {
  const [queryFilters, setQueryFilters] = useQueryState(
    'filters',
    parseAsJson<Filter[]>(),
  );
  const [savedFilters, setSavedFilters] = useLocalStorage<SavedFilters>(
    'hdx-saved-search-filters',
    {},
  );
  const showSaveButton = useMemo(
    // true if no saved filter matches the current filters
    () =>
      queryFilters &&
      queryFilters.length > 0 &&
      !Object.entries(savedFilters).some(
        ([_, filter]) =>
          objectHash.sha1(filter) === objectHash.sha1(queryFilters),
      ),
    [queryFilters, savedFilters],
  );
  const removeFilter = useCallback(
    (label: string) => {
      const newFilters = structuredClone(savedFilters);
      delete newFilters[label];
      setSavedFilters(newFilters);
    },
    [savedFilters, setSavedFilters],
  );

  const SavedFilterOption = ({
    label,
    filters,
  }: {
    label: string;
    filters: Filter[];
  }) => {
    const [isHovered, setIsHovered] = useState(false);
    const active = objectHash.sha1(filters) === objectHash.sha1(queryFilters);
    return (
      <Group
        key={label}
        justify="space-between"
        wrap="nowrap"
        onMouseOver={() => setIsHovered(true)}
        onMouseOut={() => setIsHovered(false)}
        className={classes.highlightRow}
      >
        <Text
          size="xs"
          c={active ? 'green' : 'gray.3'}
          w="100%"
          pl="xs"
          onClick={() => setQueryFilters(filters)}
          style={{ cursor: 'pointer', opacity: 0.8 }}
        >
          {label}
        </Text>
        {/* ONLY SHOW X IF HOVERING OVER THIS COMPONENT */}
        <UnstyledButton
          className={classes.highlightButton}
          style={{ visibility: isHovered ? 'inherit' : 'hidden' }}
          p="2px"
          onClick={() => removeFilter(label)}
        >
          <i className="bi bi-x"></i>
        </UnstyledButton>
      </Group>
    );
  };

  return (
    <Stack gap={0}>
      {(Object.keys(savedFilters).length > 0 || showSaveButton) && (
        <Text size="xxs" c="dimmed" fw="bold">
          Saved Filters
        </Text>
      )}
      {Object.keys(savedFilters).length > 0 && (
        <Stack gap={0}>
          {Object.entries(savedFilters).map(([label, filters]) => (
            <SavedFilterOption key={label} label={label} filters={filters} />
          ))}
        </Stack>
      )}
      {showSaveButton && <SaveFilterInput />}
    </Stack>
  );
}

type FilterStateHook = ReturnType<typeof useSearchPageFilterState>;

export const DBSearchPageFilters = ({
  filters: filterState,
  clearAllFilters,
  clearFilter,
  setFilterValue,
  isLive,
  chartConfig,
  analysisMode,
  setAnalysisMode,
}: {
  analysisMode: 'results' | 'delta' | 'pattern';
  setAnalysisMode: (mode: 'results' | 'delta' | 'pattern') => void;
  isLive: boolean;
  chartConfig: ChartConfigWithDateRange;
} & FilterStateHook) => {
  const { width, startResize } = useResizable(16, 'left');

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
          Object.keys(filterState).includes(field.path), // keep selected fields
      )
      .map(({ path }) => path)
      .filter(path => !['Body', 'Timestamp'].includes(path));

    return strings;
  }, [data, filterState, showMoreFields]);

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

  const shownFacets = useMemo(() => {
    const _facets: { key: string; value: string[] }[] = [];
    for (const facet of facets ?? []) {
      // don't include empty facets, unless they are already selected
      const filter = filterState[facet.key];
      const hasSelectedValues =
        filter && (filter.included.size > 0 || filter.excluded.size > 0);
      if (facet.value?.length > 0 || hasSelectedValues) {
        _facets.push(facet);
      }
    }
    return _facets;
  }, [facets, filterState]);

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

          <SavedFilters />

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
