import { useCallback, useMemo } from 'react';
import { Group, MultiSelect, Text } from '@mantine/core';

import { MultiSourceColumnOption } from '@/hooks/useMultiSourceSearch';

/**
 * Multi-source replacement for the free-text SELECT editor: pick extra
 * columns from the union of the selected sources' top-level columns. Columns
 * missing from a source render as blank cells for that source's rows.
 */
export default function MultiSourceColumnPicker({
  unionColumns,
  totalSources,
  value,
  onChange,
}: {
  unionColumns: MultiSourceColumnOption[];
  totalSources: number;
  /** Currently selected extra column names. */
  value: string[];
  onChange: (columns: string[]) => void;
}) {
  const availabilityByName = useMemo(
    () => new Map(unionColumns.map(c => [c.name, c.availableCount])),
    [unionColumns],
  );

  const data = useMemo(
    () =>
      unionColumns.map(c => ({
        value: c.name,
        label: c.name,
      })),
    [unionColumns],
  );

  const renderOption = useCallback(
    ({ option }: { option: { value: string; label: string } }) => {
      const available = availabilityByName.get(option.value) ?? 0;
      return (
        <Group gap="xs" wrap="nowrap" w="100%" justify="space-between">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {option.label}
          </span>
          {available < totalSources && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {available}/{totalSources} sources
            </Text>
          )}
        </Group>
      );
    },
    [availabilityByName, totalSources],
  );

  return (
    <MultiSelect
      size="xs"
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      placeholder={value.length === 0 ? 'Add columns' : undefined}
      aria-label="Add columns"
      maxDropdownHeight={280}
      renderOption={renderOption}
      data-testid="multi-source-column-picker"
    />
  );
}
