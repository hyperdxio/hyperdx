import { useMemo, useState } from 'react';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Autocomplete, Button, Popover, Select, Stack } from '@mantine/core';
import { IconFilterPlus } from '@tabler/icons-react';

import { useGetKeyValues } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';

const VALUE_LIMIT = 50;

export function AddFilterControl({
  fields,
  searchFilters,
  chartConfig,
}: {
  fields: string[];
  searchFilters: FilterStateHook;
  chartConfig?: BuilderChartConfigWithDateRange;
}) {
  const [opened, setOpened] = useState(false);
  const [field, setField] = useState<string | null>(null);
  const [polarity, setPolarity] = useState<'include' | 'exclude'>('include');
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

  const canAdd = Boolean(field && value.trim());

  const handleAdd = () => {
    if (!field || !value.trim()) {
      return;
    }
    searchFilters.setFilterValue(
      field,
      value.trim(),
      polarity === 'exclude' ? 'exclude' : undefined,
    );
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
        <Button
          variant="subtle"
          size="compact-xs"
          leftSection={<IconFilterPlus size={14} />}
          onClick={() => setOpened(o => !o)}
          aria-label="Add filter"
        >
          Add filter
        </Button>
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
            data={[
              { value: 'include', label: 'is' },
              { value: 'exclude', label: 'is not' },
            ]}
            value={polarity}
            onChange={next => {
              if (next === 'include' || next === 'exclude') {
                setPolarity(next);
              }
            }}
            aria-label="Filter operator"
          />
          <Autocomplete
            size="xs"
            placeholder={isFetching ? 'Loading values...' : 'Value'}
            data={valueOptions}
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
            disabled={!canAdd}
            onClick={handleAdd}
          >
            Add
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
