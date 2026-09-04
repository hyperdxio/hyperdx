import { useMemo, useState } from 'react';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Autocomplete,
  Button,
  Popover,
  Select,
  Stack,
  Tooltip,
} from '@mantine/core';
import { IconFilterPlus } from '@tabler/icons-react';

import { useGetKeyValues } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';

import {
  buildFilterUpdate,
  type FilterOperator,
  isComparison,
  operatorOptions,
  resolveOperator,
  toFilterOperator,
} from './addFilterModel';

const VALUE_LIMIT = 50;

export function AddFilterControl({
  fields,
  numericFields,
  searchFilters,
  chartConfig,
}: {
  fields: string[];
  /** Fields whose ClickHouse type is numeric, so a bound can be compared. */
  numericFields?: ReadonlySet<string>;
  searchFilters: FilterStateHook;
  chartConfig?: BuilderChartConfigWithDateRange;
}) {
  const [opened, setOpened] = useState(false);
  const [field, setField] = useState<string | null>(null);
  const [operator, setOperator] = useState<FilterOperator>('include');
  const [value, setValue] = useState('');

  const valueChartConfig = useMemo(
    () =>
      chartConfig ? { ...chartConfig, where: '', filters: [] } : undefined,
    [chartConfig],
  );

  const { data: keyValues, isFetching } = useGetKeyValues(
    {
      chartConfig: valueChartConfig,
      keys: field ? [field] : [],
      limit: VALUE_LIMIT,
    },
    { enabled: opened && !!field && !!valueChartConfig },
  );

  const valueOptions = useMemo(
    () => Array.from(new Set(keyValues?.[0]?.value ?? [])),
    [keyValues],
  );

  const fieldOptions = useMemo(
    () => fields.map(name => ({ value: name, label: name })),
    [fields],
  );

  const fieldIsNumeric = field != null && (numericFields?.has(field) ?? false);
  const effectiveOperator = resolveOperator(operator, fieldIsNumeric);

  const update =
    field == null
      ? null
      : buildFilterUpdate({
          operator: effectiveOperator,
          value,
          existingRange: searchFilters.filters[field]?.range,
        });

  const handleAdd = () => {
    if (field == null || update == null) {
      return;
    }
    if (update.kind === 'range') {
      searchFilters.mergeFilterValues({
        [field]: {
          included: new Set(),
          excluded: new Set(),
          range: update.range,
        },
      });
    } else {
      searchFilters.setFilterValue(
        field,
        update.value,
        update.exclude ? 'exclude' : undefined,
      );
    }
    setValue('');
    setOpened(false);
  };

  return (
    <Popover
      position="bottom-start"
      shadow="md"
      opened={opened}
      onChange={setOpened}
    >
      <Popover.Target>
        <Tooltip label="Add filter" fz="xs" color="gray">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setOpened(o => !o)}
            aria-label="Add filter"
          >
            <IconFilterPlus size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={260}>
          <Select
            size="xs"
            searchable
            placeholder="Field"
            data={fieldOptions}
            value={field}
            onChange={setField}
            comboboxProps={{ withinPortal: false }}
            aria-label="Filter field"
          />
          <Select
            size="xs"
            data={operatorOptions(fieldIsNumeric)}
            value={effectiveOperator}
            onChange={next => {
              const picked = toFilterOperator(next);
              if (picked != null) {
                setOperator(picked);
              }
            }}
            // In the portal the option list is outside this popover, so
            // picking an operator reads as a click outside and shuts the whole
            // form. Same reason as the two selects around it.
            comboboxProps={{ withinPortal: false }}
            aria-label="Filter operator"
          />
          <Autocomplete
            size="xs"
            placeholder={
              isFetching
                ? 'Loading values...'
                : isComparison(effectiveOperator)
                  ? 'Number'
                  : 'Value'
            }
            // Distinct values are suggestions for equality, but for a bound
            // they are only a hint at the range, so the field stays free text.
            data={isComparison(effectiveOperator) ? [] : valueOptions}
            value={value}
            onChange={setValue}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAdd();
              }
            }}
            comboboxProps={{ withinPortal: false }}
            aria-label="Filter value"
          />
          <Button
            variant="primary"
            size="compact-xs"
            disabled={update == null}
            onClick={handleAdd}
          >
            Add
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
