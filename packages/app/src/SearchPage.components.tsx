import React from 'react';
import cx from 'classnames';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  ActionIcon,
  Card,
  Checkbox,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';

import { Icon } from './components/Icon';
import api from './api';
import { parseQuery, useSearchPageFilterState } from './searchFilters';

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
    <UnstyledButton onClick={onClick}>
      <Text size="xxs" c="gray.6" className={classes.textButton} lh={1}>
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

export const FilterGroup = ({
  name,
  options,
  optionsLoading,
  selectedValues = new Set(),
  onChange,
  onClearClick,
  onOnlyClick,
}: FilterGroupProps) => {
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {name}
        </Text>
        {selectedValues.size > 0 && (
          <TextButton label="Clear" onClick={onClearClick} />
        )}
      </Group>
      <Stack gap={0}>
        {optionsLoading && <Text c="dimmed">Loading...</Text>}
        {options.map(option => (
          <FilterCheckbox
            key={option.value}
            label={option.label}
            value={selectedValues.has(option.value)}
            onChange={() => onChange(option.value)}
            onClickOnly={() => onOnlyClick(option.value)}
          />
        ))}
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

  const { setFilterValue, filters, filtersQuery, clearFilter, userQuery } =
    useSearchPageFilterState({ searchQuery });

  React.useEffect(() => {
    onSearchQueryChange([userQuery, filtersQuery].filter(Boolean).join(' '));
  }, [userQuery, filtersQuery]);

  if (!filtersVisible) {
    return null;
  }

  return (
    <div className={classes.filtersPanel}>
      <Stack gap="sm">
        <Text size="xxs" c="dimmed" fw="bold">
          Filters
        </Text>

        {userQuery && (
          <Card py={6} px="xs" bg="dark" m="-3" mb={4}>
            <Text size="xxs" c="gray.5" lh={1.2}>
              {userQuery}
            </Text>
          </Card>
        )}

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
      title="Refresh Dashboard"
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
