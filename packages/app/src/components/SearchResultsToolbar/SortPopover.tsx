import { useRef, useState } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { findBalancedParens } from '@hyperdx/common-utils/dist/variables';
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
import { parseAsSortingStateString } from '@/utils/queryParsers';

import { ClausePopover } from './ClausePopover';

const DIRECTION_OPTIONS = [
  { label: 'Asc', value: 'asc' },
  { label: 'Desc', value: 'desc' },
];

type SortKey = { id: string; desc: boolean };
type SortRow = SortKey & { rowId: string };

let rowSeq = 0;
const toRows = (keys: SortKey[] | null): SortRow[] | null =>
  keys?.map(key => ({ ...key, rowId: `sort-${rowSeq++}` })) ?? null;

/**
 * Sort keys the picker can edit. A parenthesized list with one direction,
 * `(toDateTime(Timestamp), Timestamp) DESC`, is several fields sharing that
 * direction, including function calls. The parentheses have to wrap that whole
 * expression: `(a, b) ASC, (c, d) DESC` is two keys, not one list. Anything
 * without a plain ASC/DESC on each field stays in SQL.
 */
/** A comma inside backticks cannot be split without breaking the identifier. */
function hasCommaInsideBackticks(input: string): boolean {
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== '`') {
      if (quoted && input[i] === ',') return true;
      continue;
    }
    // ClickHouse escapes a backtick by doubling it.
    if (quoted && input[i + 1] === '`') {
      i += 1;
      continue;
    }
    quoted = !quoted;
  }
  return false;
}

function parseSortKeys(orderBy: string): SortKey[] | null {
  const trimmed = orderBy.trim();
  if (!trimmed) return [];
  // A comma inside a backtick-quoted name would be split into extra fields.
  if (hasCommaInsideBackticks(trimmed)) return null;

  // [\s\S] so a newline inside `(toDateTime(Timestamp),\n Timestamp) DESC`
  // still counts as one direction. `.` would miss it and hide the Fields controls.
  const direction = trimmed.match(/^([\s\S]*)\s+(asc|desc)$/i);
  const expr = direction?.[1].trim() ?? '';
  if (
    direction &&
    expr.startsWith('(') &&
    findBalancedParens(expr, 0) === expr.length - 1
  ) {
    const ids = splitAndTrimWithBracket(expr.slice(1, -1));
    if (ids.length > 1 && ids.every(id => id.length > 0)) {
      const desc = direction[2].toUpperCase() === 'DESC';
      return ids.map(id => ({ id, desc }));
    }
  }

  const keys: SortKey[] = [];
  for (const part of splitAndTrimWithBracket(trimmed)) {
    const parsed = parseAsSortingStateString.parse(part);
    if (parsed == null || parsed.id.length === 0) return null;
    keys.push({ id: parsed.id, desc: parsed.desc });
  }
  return keys;
}

function serializeSortKeys(keys: SortKey[]) {
  return keys
    .filter(key => key.id.trim())
    .map(key =>
      parseAsSortingStateString.serialize({
        id: key.id.trim(),
        desc: key.desc,
      }),
    )
    .join(', ');
}

function sameKeys(a: SortKey[], b: SortKey[]) {
  return (
    a.length === b.length &&
    a.every((key, i) => key.id === b[i].id && key.desc === b[i].desc)
  );
}

function sortSummary(orderBy: string): { summary: string; count: number } {
  const keys = parseSortKeys(orderBy);
  if (keys == null) {
    const summary = orderBy.trim() || 'none';
    // An expression the field list cannot split stays one value. A number
    // would invent a field count the user cannot see in the list.
    return { summary, count: summary === 'none' ? 0 : 1 };
  }
  if (keys.length === 0) return { summary: 'none', count: 0 };
  if (keys.length === 1) {
    return {
      summary: `${keys[0].id} ${keys[0].desc ? 'desc' : 'asc'}`,
      count: 1,
    };
  }
  return { summary: `${keys.length} fields`, count: keys.length };
}

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
    if (!trimmed || used.has(trimmed)) return;
    commitKeys([
      ...(keys ?? []),
      { id: trimmed, desc: true, rowId: `sort-${rowSeq++}` },
    ]);
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
      resetDisabled={draft.trim() === defaultValue.trim()}
      onApply={() =>
        onApply(
          draft.trim() === defaultValue.trim()
            ? ''
            : draft === baseline
              ? value
              : draft,
        )
      }
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
