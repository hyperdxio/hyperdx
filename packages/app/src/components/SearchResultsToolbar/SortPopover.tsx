import { useRef, useState } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ActionIcon,
  Autocomplete,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';

import {
  clauseApplyDisabled,
  ClausePopover,
  clauseResetDisabled,
  storedClause,
} from './ClausePopover';
import {
  newSortRow,
  parseSortKeys,
  sameKeys,
  serializeSortKeys,
  SortRow,
  sortSummary,
  toRows,
} from './sortClause';

const DIRECTION_OPTIONS = [
  { label: 'Asc', value: 'asc' },
  { label: 'Desc', value: 'desc' },
];

export function SortPopover({
  value,
  defaultValue,
  fieldOptions,
  onApply,
  tableConnection,
  sourceId,
  dateRange,
}: {
  /** The ORDER BY expression in the search form. */
  value: string;
  /** The source's ORDER BY, used while `value` is empty. */
  defaultValue: string;
  fieldOptions: string[];
  onApply: (orderBy: string) => void;
  tableConnection: TableConnection | undefined;
  sourceId?: string;
  dateRange?: [Date, Date];
}) {
  const shown = value || defaultValue;
  const [draft, setDraft] = useState(shown);
  const [keys, setKeys] = useState<SortRow[] | null>(() =>
    toRows(parseSortKeys(shown)),
  );
  const [search, setSearch] = useState('');
  // Autocomplete writes the chosen option back into the input after
  // onOptionSubmit. Ignore that write so the field clears.
  const ignoreNextChangeRef = useRef(false);

  const baseline = value || defaultValue;
  const shownSort = sortSummary(baseline);
  const used = new Set((keys ?? []).map(key => key.id));
  const addOptions = fieldOptions.filter(option => !used.has(option));

  const reset = () => {
    const next = value || defaultValue;
    setDraft(next);
    setKeys(toRows(parseSortKeys(next)));
    setSearch('');
  };

  const commitKeys = (next: SortRow[]) => {
    setKeys(next);
    const originalKeys = parseSortKeys(baseline);
    // Keep `(a, b) DESC` until a field actually changes, so Apply doesn't
    // rewrite the source default into separate keys.
    setDraft(
      originalKeys != null && sameKeys(next, originalKeys)
        ? baseline
        : serializeSortKeys(next),
    );
  };

  const addKey = (id: string) => {
    const trimmed = id.trim();
    // A clause the field list cannot split, such as `Timestamp DESC NULLS LAST`,
    // stays intact. Adding a field here would replace the whole clause.
    if (keys == null || !trimmed || used.has(trimmed)) return;
    commitKeys([...keys, newSortRow(trimmed, true)]);
    setSearch('');
  };

  return (
    <ClausePopover
      name="Sort"
      summary={shownSort.summary}
      count={shownSort.count}
      dimmed={value.trim() === ''}
      title={baseline}
      initialMode={parseSortKeys(baseline) != null ? 'pick' : 'sql'}
      onOpen={reset}
      onReset={() => {
        setDraft(defaultValue);
        setKeys(toRows(parseSortKeys(defaultValue)));
        setSearch('');
      }}
      resetDisabled={clauseResetDisabled(draft, defaultValue)}
      applyDisabled={clauseApplyDisabled(draft)}
      onApply={() => onApply(storedClause(draft, value, defaultValue))}
      data-testid="search-sort-button"
      renderPick={() => (
        <Stack gap="xs">
          {keys == null && (
            <Text size="xs" c="dimmed" data-testid="search-sort-custom">
              Custom sort. Edit it in SQL.
            </Text>
          )}
          {keys != null && keys.length > 0 && (
            <ScrollArea.Autosize mah={220}>
              <Stack gap="xs" data-testid="search-sort-list">
                {keys.map((key, index) => (
                  <Group
                    key={key.rowId}
                    gap="xs"
                    wrap="nowrap"
                    align="flex-end"
                  >
                    <Autocomplete
                      size="xs"
                      label={index === 0 ? 'Field' : undefined}
                      aria-label={`Sort field ${index + 1}`}
                      value={key.id}
                      onChange={id => {
                        const next = keys.slice();
                        next[index] = { ...key, id };
                        commitKeys(next);
                      }}
                      data={fieldOptions.filter(
                        option => option === key.id || !used.has(option),
                      )}
                      limit={50}
                      comboboxProps={{ withinPortal: false }}
                      style={{ flex: 1 }}
                    />
                    <SegmentedControl
                      size="xs"
                      value={key.desc ? 'desc' : 'asc'}
                      onChange={direction => {
                        const next = keys.slice();
                        next[index] = { ...key, desc: direction === 'desc' };
                        commitKeys(next);
                      }}
                      data={DIRECTION_OPTIONS}
                      data-testid="search-sort-direction"
                    />
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() =>
                        commitKeys(keys.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove ${key.id}`}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
          {keys != null && (
            <Autocomplete
              size="xs"
              placeholder="Add sort"
              value={search}
              onChange={next => {
                if (ignoreNextChangeRef.current) {
                  ignoreNextChangeRef.current = false;
                  return;
                }
                setSearch(next);
              }}
              data={addOptions}
              limit={50}
              onOptionSubmit={id => {
                ignoreNextChangeRef.current = true;
                addKey(id);
              }}
              comboboxProps={{ withinPortal: false }}
              data-testid="search-sort-add-input"
            />
          )}
        </Stack>
      )}
      renderSql={apply => (
        <Stack gap={0} data-testid="search-order-by-input">
          <SQLInlineEditor
            tableConnection={tableConnection}
            value={draft}
            onChange={sql => {
              setDraft(sql);
              setKeys(toRows(parseSortKeys(sql)));
            }}
            placeholder="ORDER BY"
            onSubmit={apply}
            label="ORDER BY"
            size="xs"
            dateRange={dateRange}
            sourceId={sourceId}
          />
        </Stack>
      )}
    />
  );
}
