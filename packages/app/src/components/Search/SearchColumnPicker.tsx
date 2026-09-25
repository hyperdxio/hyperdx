import { useMemo, useState } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Popover,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconColumns } from '@tabler/icons-react';

import {
  useColumns,
  useJsonColumns,
  useMapColumns,
  useMultipleAllFields,
} from '@/hooks/useMetadata';
import { mergePath } from '@/utils';

function useColumnOptions(
  source: TSource | undefined,
  dateRange: [Date, Date] | undefined,
  enabled: boolean,
) {
  const tableConnection = useMemo(
    () => (source ? tcFromSource(source) : undefined),
    [source],
  );
  const hasTable = enabled && tableConnection != null;
  const { data: columns, isLoading: isColumnsLoading } = useColumns(
    tableConnection ?? { databaseName: '', tableName: '', connectionId: '' },
    { enabled: hasTable },
  );
  const { data: jsonColumns } = useJsonColumns(tableConnection, {
    enabled: hasTable,
  });
  const { data: mapColumns } = useMapColumns(tableConnection, {
    enabled: hasTable,
  });
  const { data: fields, isLoading: isFieldsLoading } = useMultipleAllFields(
    tableConnection ? [tableConnection] : [],
    {
      dateRange,
      timestampValueExpression: source?.timestampValueExpression,
      enabled: hasTable,
    },
  );

  const options = useMemo(() => {
    // Top-level columns come first; the field list adds map/JSON sub-keys
    // and is empty when the team has field metadata disabled.
    const all = [
      ...(columns ?? []).map(c => c.name),
      ...(fields ?? []).map(f =>
        mergePath(f.path, jsonColumns ?? [], mapColumns ?? []),
      ),
    ];
    return Array.from(new Set(all));
  }, [columns, fields, jsonColumns, mapColumns]);

  return {
    options,
    isLoading: hasTable && (isColumnsLoading || isFieldsLoading),
  };
}

/**
 * Columns checklist for the raw List view. Selections are staged locally and
 * committed on Apply, mirroring the comma-separated `select` string the search
 * page already uses. Hand-written SELECTs belong to the SQL editor.
 */
export function SearchColumnPicker({
  source,
  dateRange,
  selectedColumns,
  onApply,
  disabled,
  disabledReason,
}: {
  source?: TSource;
  dateRange?: [Date, Date];
  selectedColumns: string[];
  onApply: (columns: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>(selectedColumns);

  const { options: availableColumns, isLoading } = useColumnOptions(
    source,
    dateRange,
    opened,
  );

  // Reopening starts from the committed columns rather than an abandoned draft.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selectedColumns);
      setSearch('');
    }
    setOpened(next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Selected columns stay listed even when absent from the schema, e.g. an
    // expression written before the picker existed.
    const union = Array.from(
      new Set([...selectedColumns, ...availableColumns]),
    );
    return q ? union.filter(c => c.toLowerCase().includes(q)) : union;
  }, [search, availableColumns, selectedColumns]);

  const toggle = (column: string) => {
    setDraft(prev =>
      prev.includes(column)
        ? prev.filter(c => c !== column)
        : [...prev, column],
    );
  };

  const apply = () => {
    onApply(draft);
    setOpened(false);
  };

  const countBadge = (
    <Badge size="sm" variant="light" color="gray" radius="sm">
      {selectedColumns.length}
    </Badge>
  );

  return (
    <Popover
      opened={opened && !disabled}
      onChange={handleOpenChange}
      position="bottom-end"
      withinPortal
      shadow="md"
      width={320}
      // Flipping above the bar pushes the list off-screen on short viewports;
      // stay below and shrink the field list to fit instead.
      middlewares={{ flip: false, shift: true, size: { padding: 8 } }}
    >
      <Popover.Target>
        {/* A disabled button gets no pointer events, so the tooltip hangs off
            a wrapper instead. */}
        <Tooltip label={disabledReason} disabled={!disabled || !disabledReason}>
          <Box component="span" display="inline-flex">
            <Button
              variant="subtle"
              size="compact-sm"
              disabled={disabled}
              leftSection={<IconColumns size={14} />}
              rightSection={countBadge}
              onClick={() => handleOpenChange(!opened)}
              data-testid="search-column-picker"
            >
              Columns
            </Button>
          </Box>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown
        p="xs"
        data-testid="search-column-picker-dropdown"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <TextInput
          size="xs"
          placeholder="Search fields"
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          mb="xs"
          autoFocus
          rightSection={isLoading ? <Loader size={12} /> : undefined}
        />
        <Group gap="xs" mb="xs" grow>
          {/* Only offered while searching: unfiltered, "all" would add every
              map sub-key on the table. */}
          {search.trim() !== '' && (
            <Button
              variant="secondary"
              size="compact-xs"
              disabled={filtered.length === 0}
              onClick={() =>
                setDraft(Array.from(new Set([...draft, ...filtered])))
              }
            >
              Select matching
            </Button>
          )}
          <Button
            variant="secondary"
            size="compact-xs"
            disabled={draft.length === 0}
            onClick={() => setDraft([])}
          >
            Clear
          </Button>
        </Group>
        <Box
          style={{
            flex: '0 1 auto',
            minHeight: 0,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <Text size="xs" c="dimmed" py="xs" ta="center">
              {isLoading ? 'Loading fields' : 'No fields found'}
            </Text>
          ) : (
            filtered.map(column => (
              <Checkbox
                key={column}
                size="xs"
                my={4}
                label={column}
                checked={draft.includes(column)}
                onChange={() => toggle(column)}
              />
            ))
          )}
        </Box>
        <Button
          variant="primary"
          fullWidth
          size="xs"
          mt="xs"
          onClick={apply}
          disabled={draft.length === 0}
        >
          Apply
        </Button>
      </Popover.Dropdown>
    </Popover>
  );
}
