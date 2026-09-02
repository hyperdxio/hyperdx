import { useMemo, useState } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
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
import { IconChevronDown, IconStack2 } from '@tabler/icons-react';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { useMultipleAllFields } from '@/hooks/useMetadata';

import { formatGroupByFields, parseGroupByFields } from './exploreGroupBy';
import { fieldIdentifier } from './fieldIdentifier';

function triggerLabel(selected: string[], fallback?: string) {
  if (selected.length === 1) return selected[0];
  if (selected.length > 1) return `${selected.length} fields`;
  return fallback || 'nothing';
}

/**
 * Group by for the view, not for the set of series. Events and Charts describe
 * the same dimension — the events histogram has always been a stacked bar with
 * a grouping, it was just pinned to severity or status code — so keeping one
 * control in the toolbar is what lets the grouping survive a view switch
 * instead of being rebuilt on each side.
 *
 * Shaped like the Columns picker it sits beside: picking a field is the common
 * case and should not require writing SQL, but the expression escape hatch stays
 * one click away because group by accepts anything ClickHouse will group on.
 */
export function ExploreGroupByControl({
  tableSource,
  value,
  onApply,
  dateRange,
  defaultGroupBy,
  disabled,
}: {
  tableSource?: TSource;
  /** Comma-separated, as the query layer expects. */
  value: string;
  onApply: (next: string) => void;
  dateRange?: [Date, Date];
  /** Applied when nothing is picked; shown on the trigger so it is not a secret. */
  defaultGroupBy?: string;
  disabled?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'fields' | 'sql'>('fields');
  const [draft, setDraft] = useState<string[]>([]);
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

  const selected = useMemo(() => parseGroupByFields(value), [value]);

  // Nested map keys matter here — grouping by `ResourceAttributes['host']` is
  // as ordinary as grouping by a top-level column, so the list is every field
  // rather than the table's columns.
  const available = useMemo(
    () => (fields ?? []).map(fieldIdentifier),
    [fields],
  );

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selected);
      setSqlDraft(value);
      setSearch('');
      setMode('fields');
    }
    setOpened(next);
  };

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Selected first, and kept even when absent from the schema: an expression
    // typed through the SQL tab is still a grouping the reader chose.
    const union = Array.from(new Set([...selected, ...available]));
    return q ? union.filter(f => f.toLowerCase().includes(q)) : union;
  }, [search, available, selected]);

  const commit = (next: string) => {
    onApply(next);
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
          leftSection={<IconStack2 size={14} />}
          rightSection={<IconChevronDown size={14} />}
          onClick={() => handleOpenChange(!opened)}
          data-testid="explore-group-by"
          style={{ flexShrink: 0 }}
        >
          <Text
            size="xs"
            span
            c={selected.length === 0 ? 'dimmed' : undefined}
            style={{
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            by {triggerLabel(selected, defaultGroupBy)}
          </Text>
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
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
              placeholder={defaultGroupBy || 'SQL columns'}
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
                  options.map(field => (
                    <Checkbox
                      key={field}
                      size="xs"
                      my={4}
                      label={field}
                      checked={draft.includes(field)}
                      onChange={() =>
                        setDraft(prev =>
                          prev.includes(field)
                            ? prev.filter(f => f !== field)
                            : [...prev, field],
                        )
                      }
                    />
                  ))
                )}
              </Box>
            </ScrollArea.Autosize>
            <Group gap="xs" mt="xs" grow>
              <Button
                variant="secondary"
                size="xs"
                disabled={draft.length === 0}
                onClick={() => setDraft([])}
              >
                Clear
              </Button>
              <Button
                size="xs"
                onClick={() => commit(formatGroupByFields(draft))}
              >
                Apply
              </Button>
            </Group>
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
