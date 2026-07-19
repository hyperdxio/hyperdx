import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Group,
  Popover,
  ScrollArea,
  SegmentedControl,
  Text,
  TextInput,
} from '@mantine/core';
import { IconChevronDown, IconColumns } from '@tabler/icons-react';

/**
 * Columns checklist that replaces the free-form SELECT editor for the raw List
 * view. Selections are staged locally and committed on Apply, mirroring the
 * comma-separated `select` string the search page already uses.
 */
export function SearchColumnPicker({
  availableColumns,
  selectedColumns,
  onApply,
  disabled,
  sqlSlot,
}: {
  availableColumns: string[];
  selectedColumns: string[];
  onApply: (columns: string[]) => void;
  disabled?: boolean;
  sqlSlot?: React.ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>(selectedColumns);
  const [mode, setMode] = useState<'fields' | 'sql'>('fields');

  // Re-seed the draft from the committed columns each time the popover opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selectedColumns);
      setSearch('');
    }
    setOpened(next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Always surface currently-selected columns even if not in the schema list
    // (e.g. SQL expressions the user typed previously).
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

  return (
    <Popover
      opened={opened}
      onChange={handleOpenChange}
      position="bottom-end"
      withinPortal
      shadow="md"
      width={280}
    >
      <Popover.Target>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          disabled={disabled}
          leftSection={<IconColumns size={14} />}
          rightSection={<IconChevronDown size={14} />}
          onClick={() => handleOpenChange(!opened)}
          data-testid="search-column-picker"
        >
          Columns {selectedColumns.length}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {Boolean(sqlSlot) && (
          <SegmentedControl
            fullWidth
            size="xs"
            mb="xs"
            value={mode}
            onChange={value => setMode(value as 'fields' | 'sql')}
            data={[
              { label: 'Fields', value: 'fields' },
              { label: 'SQL', value: 'sql' },
            ]}
          />
        )}
        {mode === 'sql' && sqlSlot ? (
          <Box>{sqlSlot}</Box>
        ) : (
          <>
            <TextInput
              size="xs"
              placeholder="Search columns…"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              mb="xs"
              autoFocus
            />
            <Group gap="xs" mb="xs" grow>
              <Button
                variant="secondary"
                size="compact-xs"
                onClick={() =>
                  setDraft(Array.from(new Set([...draft, ...filtered])))
                }
              >
                + All
              </Button>
              <Button
                variant="secondary"
                size="compact-xs"
                onClick={() =>
                  setDraft(draft.filter(c => !filtered.includes(c)))
                }
              >
                − None
              </Button>
            </Group>
            <ScrollArea.Autosize mah={260} type="auto">
              <Box>
                {filtered.length === 0 ? (
                  <Text size="xs" c="dimmed" py="xs" ta="center">
                    No columns found
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
            </ScrollArea.Autosize>
            <Button
              fullWidth
              size="xs"
              mt="xs"
              onClick={apply}
              disabled={draft.length === 0}
            >
              Apply
            </Button>
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
