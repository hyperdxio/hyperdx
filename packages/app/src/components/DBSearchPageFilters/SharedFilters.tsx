import { memo, useMemo, useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Center,
  Collapse,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChevronDown,
  IconFilterOff,
  IconPin,
  IconPinFilled,
} from '@tabler/icons-react';

import type { PinnedFiltersApiResponse } from '@/pinnedFilters';

import { FilterCheckbox } from '../DBSearchPageFilters';

import classes from '../../../styles/SearchPage.module.scss';

interface SharedFiltersProps {
  teamData: PinnedFiltersApiResponse['team'];
  /** Live facet data from the search query — used to populate dynamic values for pinned fields */
  facets: { key: string; value: (string | boolean)[] }[];
  filterState: Record<
    string,
    {
      included: Set<string | boolean>;
      excluded: Set<string | boolean>;
      range?: { min: number; max: number };
    }
  >;
  onFilterChange: (key: string, value: string | boolean) => void;
  onFilterOnly: (key: string, value: string | boolean) => void;
  onFilterExclude: (key: string, value: string | boolean) => void;
  onFilterClear: (key: string) => void;
  onToggleFilterPin: (key: string, value: string | boolean) => void;
  onToggleFieldPin: (key: string) => void;
  isFilterPinned: (key: string, value: string | boolean) => boolean;
  isFieldPinned: (key: string) => boolean;
}

function SharedFilterGroup({
  name,
  values,
  selectedValues,
  onFilterChange,
  onFilterOnly,
  onFilterExclude,
  onFilterClear,
  onToggleFilterPin,
  onToggleFieldPin,
  isFilterPinned,
  isFieldPinned,
}: {
  name: string;
  values: (string | boolean)[];
  selectedValues: {
    included: Set<string | boolean>;
    excluded: Set<string | boolean>;
  };
  onFilterChange: (value: string | boolean) => void;
  onFilterOnly: (value: string | boolean) => void;
  onFilterExclude: (value: string | boolean) => void;
  onFilterClear: VoidFunction;
  onToggleFilterPin: (value: string | boolean) => void;
  onToggleFieldPin: VoidFunction;
  isFilterPinned: (value: string | boolean) => boolean;
  isFieldPinned: boolean;
}) {
  const [isExpanded, setExpanded] = useState(true);

  const totalAppliedFiltersSize =
    selectedValues.included.size + selectedValues.excluded.size;

  return (
    <Accordion
      variant="unstyled"
      chevronPosition="left"
      classNames={{ chevron: classes.chevron }}
      value={isExpanded ? name : null}
      onChange={v => setExpanded(v === name)}
    >
      <Accordion.Item value={name}>
        <Stack gap={0}>
          <Center>
            <Accordion.Control
              component={UnstyledButton}
              flex="1"
              p="0"
              pr="xxxs"
              style={{ overflow: 'hidden' }}
              classNames={{
                chevron: 'm-0',
                label: 'p-0',
              }}
            >
              <Tooltip
                openDelay={name.length > 26 ? 0 : 1500}
                label={name}
                position="top"
                withArrow
                fz="xxs"
                color="gray"
              >
                <Text size="xs" truncate="end" flex={1}>
                  {name}
                </Text>
              </Tooltip>
            </Accordion.Control>
            <Group gap={0} wrap="nowrap">
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
                  onClick={onToggleFieldPin}
                >
                  {isFieldPinned ? (
                    <IconPinFilled size={14} />
                  ) : (
                    <IconPin size={14} />
                  )}
                </ActionIcon>
              </Tooltip>
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
                    onClick={onFilterClear}
                  >
                    <IconFilterOff size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Center>
          <Accordion.Panel
            classNames={{
              content: 'p-0 pt-2',
            }}
          >
            <Stack gap={0}>
              {values.map(value => {
                const label = value.toString();
                const isIncluded = selectedValues.included.has(value);
                const isExcluded = selectedValues.excluded.has(value);
                const checked: 'included' | 'excluded' | false = isIncluded
                  ? 'included'
                  : isExcluded
                    ? 'excluded'
                    : false;

                return (
                  <FilterCheckbox
                    key={label}
                    columnName={name}
                    value={checked}
                    label={label}
                    pinned={isFilterPinned(value)}
                    onChange={() => onFilterChange(value)}
                    onClickOnly={() => onFilterOnly(value)}
                    onClickExclude={() => onFilterExclude(value)}
                    onClickPin={() => onToggleFilterPin(value)}
                  />
                );
              })}
              {values.length === 0 && (
                <Text c="dimmed" size="xs" p={6}>
                  No pinned values
                </Text>
              )}
            </Stack>
          </Accordion.Panel>
        </Stack>
      </Accordion.Item>
    </Accordion>
  );
}

function SharedFiltersComponent({
  teamData,
  facets,
  filterState,
  onFilterChange,
  onFilterOnly,
  onFilterExclude,
  onFilterClear,
  onToggleFilterPin,
  onToggleFieldPin,
  isFilterPinned,
  isFieldPinned,
}: SharedFiltersProps) {
  const [opened, { toggle }] = useDisclosure(true);

  // Build facets for the shared section.
  // For each pinned field: if it has pinned values, show those.
  // If it has no pinned values (field-only pin), show dynamic values from the live query.
  const sharedFacets = useMemo(() => {
    if (!teamData) return [];

    const pinnedFields = new Set(teamData.fields);
    const pinnedFilterKeys = Object.keys(teamData.filters);
    const allKeys = new Set([...pinnedFields, ...pinnedFilterKeys]);

    if (allKeys.size === 0) return [];

    const facetMap = new Map(facets.map(f => [f.key, f.value]));

    return Array.from(allKeys).map(key => {
      const pinnedValues = teamData.filters[key] ?? [];
      if (pinnedValues.length > 0) {
        // Has specific pinned values — show those (merged with dynamic for completeness)
        const dynamicValues = facetMap.get(key) ?? [];
        const merged = [...pinnedValues];
        for (const v of dynamicValues) {
          if (!merged.some(existing => existing === v)) {
            merged.push(v);
          }
        }
        return { key, value: merged };
      }
      // Field-only pin — show dynamic values from the live query
      return { key, value: facetMap.get(key) ?? [] };
    });
  }, [teamData, facets]);

  if (sharedFacets.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs" data-testid="shared-filters-section">
      <UnstyledButton onClick={toggle} data-testid="shared-filters-toggle">
        <Flex align="center" justify="space-between">
          <Group gap={4}>
            <IconPinFilled
              size={12}
              style={{ color: 'var(--mantine-color-gray-6)' }}
            />
            <Text size="xxs" c="dimmed" fw="bold">
              Shared Filters
            </Text>
          </Group>
          <IconChevronDown
            size={14}
            color="var(--mantine-color-gray-6)"
            style={{
              transition: 'transform 0.2s ease-in-out',
              transform: opened ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        </Flex>
      </UnstyledButton>
      <Collapse in={opened}>
        <Stack gap={0}>
          {sharedFacets.map(facet => (
            <SharedFilterGroup
              key={facet.key}
              name={facet.key}
              values={facet.value}
              selectedValues={
                filterState[facet.key]
                  ? filterState[facet.key]
                  : { included: new Set(), excluded: new Set() }
              }
              onFilterChange={value => onFilterChange(facet.key, value)}
              onFilterOnly={value => onFilterOnly(facet.key, value)}
              onFilterExclude={value => onFilterExclude(facet.key, value)}
              onFilterClear={() => onFilterClear(facet.key)}
              onToggleFilterPin={value => onToggleFilterPin(facet.key, value)}
              onToggleFieldPin={() => onToggleFieldPin(facet.key)}
              isFilterPinned={value => isFilterPinned(facet.key, value)}
              isFieldPinned={isFieldPinned(facet.key)}
            />
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}

export const SharedFilters = memo(SharedFiltersComponent);
