import { useMemo, useState } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Group,
  Popover,
  Radio,
  ScrollArea,
  SegmentedControl,
  Text,
  TextInput,
} from '@mantine/core';
import { IconBracketsContain, IconChevronDown } from '@tabler/icons-react';

import { fieldIdentifier } from '@/components/Explore/fieldIdentifier';
import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { useMultipleAllFields } from '@/hooks/useMetadata';

function triggerLabel(value: string, fallback?: string) {
  return value.trim() || fallback || 'default';
}

/**
 * Which field Drain reads when clustering events. Shaped like Group by and
 * Columns: picking a field is the common case and should not require writing
 * SQL, but an expression tab stays one click away for concat / JSONExtract.
 *
 * Single-select, unlike Group by — Drain clusters one string per event.
 */
export function PatternColumnSelector({
  tableSource,
  value,
  onApply,
  dateRange,
  defaultField,
  disabled,
}: {
  tableSource?: TSource;
  /** Committed column or SQL expression; empty means the source default. */
  value: string;
  onApply: (next: string) => void;
  dateRange?: [Date, Date];
  /** Source body / span name, shown on the trigger so the default is not a secret. */
  defaultField?: string;
  disabled?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'fields' | 'sql'>('fields');
  const [sqlDraft, setSqlDraft] = useState(value);

  const tableConnection = tcFromSource(tableSource);
  const { data: fields } = useMultipleAllFields(
    tableConnection ? [tableConnection] : [],
    {
      dateRange,
      timestampValueExpression: tableSource?.timestampValueExpression,
      enabled: opened && Boolean(tableConnection),
    },
  );

  const available = useMemo(
    () => (fields ?? []).map(fieldIdentifier),
    [fields],
  );

  const effective = value.trim() || defaultField || '';

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSqlDraft(value);
      setSearch('');
      setMode('fields');
    }
    setOpened(next);
  };

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const union = Array.from(
      new Set([...(effective ? [effective] : []), ...available]),
    );
    return q ? union.filter(f => f.toLowerCase().includes(q)) : union;
  }, [search, available, effective]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    onApply(trimmed === defaultField ? '' : trimmed);
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={handleOpenChange}
      position="bottom-start"
      withinPortal
      shadow="md"
      width={300}
    >
      <Popover.Target>
        <Button
          variant="secondary"
          size="xs"
          disabled={disabled}
          leftSection={<IconBracketsContain size={14} />}
          rightSection={<IconChevronDown size={14} />}
          onClick={() => handleOpenChange(!opened)}
          data-testid="explore-pattern-field"
          style={{ flexShrink: 0 }}
        >
          <Text
            size="xs"
            span
            c={!value.trim() ? 'dimmed' : undefined}
            style={{
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            on {triggerLabel(value, defaultField)}
          </Text>
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Text size="xs" c="dimmed" mb="xs">
          Events that share the same shape in this field are grouped. Sampled
          from up to 10,000 events.
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          mb="xs"
          value={mode}
          onChange={next => setMode(next === 'sql' ? 'sql' : 'fields')}
          data={[
            { label: 'Fields', value: 'fields' },
            { label: 'SQL', value: 'sql' },
          ]}
        />
        {mode === 'sql' ? (
          <Box>
            <SQLInlineEditor
              tableConnection={tableConnection}
              value={sqlDraft}
              onChange={setSqlDraft}
              onSubmit={() => commit(sqlDraft)}
              placeholder={
                defaultField
                  ? `Default (${defaultField}) — column or expression`
                  : 'Column or expression'
              }
              size="xs"
              allowMultiline={false}
              disableKeywordAutocomplete
              sourceId={tableSource?.id}
              dateRange={dateRange}
            />
            <Button
              fullWidth
              size="xs"
              mt="xs"
              onClick={() => commit(sqlDraft)}
            >
              Apply
            </Button>
          </Box>
        ) : (
          <>
            <TextInput
              size="xs"
              placeholder="Search fields…"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              mb="xs"
              autoFocus
            />
            <ScrollArea.Autosize mah={260} type="auto">
              <Box>
                {options.length === 0 ? (
                  <Text size="xs" c="dimmed" py="xs" ta="center">
                    No fields found
                  </Text>
                ) : (
                  <Radio.Group
                    value={effective}
                    onChange={field => commit(field)}
                  >
                    {options.map(field => (
                      <Radio
                        key={field}
                        size="xs"
                        my={4}
                        value={field}
                        label={field}
                      />
                    ))}
                  </Radio.Group>
                )}
              </Box>
            </ScrollArea.Autosize>
            <Group gap="xs" mt="xs" grow>
              <Button
                variant="secondary"
                size="xs"
                disabled={!value.trim()}
                onClick={() => commit('')}
              >
                Use default
              </Button>
            </Group>
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
