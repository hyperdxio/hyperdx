import React from 'react';
import cx from 'classnames';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  ActionIcon,
  Card,
  Checkbox,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';

import { Icon } from './components/Icon';
import api from './api';
import { useSearchPageFilterState } from './searchFilters';

import classes from '../styles/SearchPage.module.scss';

const filtersVisibleAtom = atomWithStorage('searchPageFiltersVisible', true);

const EVENT_TYPE_OPTIONS = [
  {
    value: 'log',
    label: (
      <>
        Logs <Icon name="braces" className="text-slate-400" />
      </>
    ),
  },
  {
    value: 'span',
    label: (
      <>
        Spans <Icon name="list-nested" className="text-slate-400" />
      </>
    ),
  },
];

const EVENT_LEVEL_OPTIONS = [
  {
    value: 'error',
    label: <Text c="red">Error</Text>,
  },
  {
    value: 'warn',
    label: <Text c="orange">Warn</Text>,
  },
  {
    value: 'ok',
    label: <Text c="green">Ok</Text>,
  },
  {
    value: 'info',
    label: <Text c="blue">Info</Text>,
  },
  {
    value: 'debug',
    label: <Text c="gray">Debug</Text>,
  },
];

type FilterCheckboxProps = {
  label: string | React.ReactNode;
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
        <Text size="xs" c="gray.5">
          {label}
        </Text>
      </Group>
      {onClickOnly && <TextButton onClick={onClickOnly} label="Only" />}
    </div>
  );
};

type FilterGroupProps = {
  name: string;
  options: { value: string; label: string | React.ReactNode }[];
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
  const [search, setSearch] = React.useState('');
  const [isExpanded, setExpanded] = React.useState(false);

  const augmentedOptions = React.useMemo(() => {
    return [
      ...Array.from(selectedValues)
        .filter(value => !options.find(option => option.value === value))
        .map(value => ({ value, label: value })),
      ...options,
    ];
  }, [options, selectedValues]);

  const displayedOptions = React.useMemo(() => {
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
      <Group justify="space-between">
        <TextInput
          size="xs"
          variant="unstyled"
          placeholder={name}
          leftSection={<Icon name="search" className="fs-8.5" />}
          value={search}
          w="60%"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(event.currentTarget.value)
          }
        />
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
                    <Icon name="chevron-up" /> Less
                  </>
                ) : (
                  <>
                    <Icon name="chevron-down" /> Show more
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

type SearchPageFiltersProps = {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
};

export const SearchPageFilters = ({
  searchQuery,
  onSearchQueryChange,
}: SearchPageFiltersProps) => {
  const [filtersVisible] = useAtom(filtersVisibleAtom);

  const { data: services, isLoading: isServicesLoading } = api.useServices();

  const servicesOptions = React.useMemo(() => {
    return Object.keys(services?.data ?? {}).map(name => ({
      value: name,
      label: name,
    }));
  }, [services]);

  const { setFilterValue, filters, clearFilter } = useSearchPageFilterState({
    searchQuery,
    onSearchQueryChange,
  });

  if (!filtersVisible) {
    return null;
  }

  return (
    <div className={classes.filtersPanel}>
      <ScrollArea h="100%" scrollbarSize={4}>
        <Stack gap="sm" p="xs">
          <Text size="xxs" c="dimmed" fw="bold">
            Filters
          </Text>

          <FilterGroup
            name="Event Type"
            options={EVENT_TYPE_OPTIONS}
            selectedValues={filters['hyperdx_event_type']}
            onChange={value => setFilterValue('hyperdx_event_type', value)}
            onClearClick={() => clearFilter('hyperdx_event_type')}
            onOnlyClick={value =>
              setFilterValue('hyperdx_event_type', value, true)
            }
          />

          <FilterGroup
            name="Level"
            options={EVENT_LEVEL_OPTIONS}
            selectedValues={filters['level']}
            onChange={value => setFilterValue('level', value)}
            onClearClick={() => clearFilter('level')}
            onOnlyClick={value => setFilterValue('level', value, true)}
          />

          <FilterGroup
            name="Service"
            options={servicesOptions}
            optionsLoading={isServicesLoading}
            selectedValues={filters['service']}
            onChange={value => setFilterValue('service', value)}
            onClearClick={() => clearFilter('service')}
            onOnlyClick={value => setFilterValue('service', value, true)}
          />
        </Stack>
      </ScrollArea>
    </div>
  );
};

export const ToggleFilterButton = () => {
  const [filtersVisible, setFiltersVisible] = useAtom(filtersVisibleAtom);

  return (
    <ActionIcon
      color="gray"
      mr="xs"
      size="lg"
      variant="subtle"
      radius="md"
      title="Toggle Filters"
      onClick={() => setFiltersVisible(!filtersVisible)}
    >
      <Icon
        name="funnel"
        className={cx(
          'fs-5',
          filtersVisible ? 'text-slate-200' : 'text-slate-500',
        )}
      />
    </ActionIcon>
  );
};
