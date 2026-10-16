import { useMemo, useState } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  ActionIcon,
  Autocomplete,
  Group,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { IconColumns, IconX } from '@tabler/icons-react';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { withMapKeyAlias } from '@/utils';

import { ClausePopover } from './ClausePopover';

export function ColumnsPopover({
  value,
  defaultValue,
  fieldOptions,
  knownColumns,
  onApply,
  tableConnection,
  sourceId,
  dateRange,
}: {
  /** The SELECT expression in the search form. */
  value: string;
  /** The source's SELECT, used while `value` is empty. */
  defaultValue: string;
  fieldOptions: string[];
  knownColumns: Set<string>;
  /** Called with the new SELECT and the items it no longer contains. */
  onApply: (select: string, removedItems: string[]) => void;
  tableConnection: TableConnection | undefined;
  sourceId?: string;
  dateRange?: [Date, Date];
}) {
  const [draft, setDraft] = useState(value);
  const [search, setSearch] = useState('');

  const effective = (select: string) =>
    splitAndTrimWithBracket(select || defaultValue);

  const count = effective(value).length;
  const items = effective(draft);

  const options = useMemo(
    () => fieldOptions.filter(option => !items.includes(option)),
    [fieldOptions, items],
  );

  const addColumn = (column: string) => {
    const trimmed = column.trim();
    if (!trimmed) return;
    setDraft(
      [...items, withMapKeyAlias(trimmed, items, knownColumns)].join(', '),
    );
    setSearch('');
  };

  const removeColumn = (item: string) => {
    setDraft(items.filter(i => i !== item).join(', '));
  };

  return (
    <ClausePopover
      label={count > 0 ? `Columns (${count})` : 'Columns'}
      title={value || defaultValue}
      icon={<IconColumns size={14} />}
      initialMode="pick"
      onOpen={() => {
        setDraft(value);
        setSearch('');
      }}
      onApply={() => {
        const next = effective(draft);
        onApply(
          draft,
          effective(value).filter(item => !next.includes(item)),
        );
      }}
      data-testid="search-columns-button"
      renderPick={() => (
        <Stack gap="xs">
          <ScrollArea.Autosize mah={220}>
            {items.length === 0 ? (
              <Text size="xs" c="dimmed">
                No columns selected.
              </Text>
            ) : (
              <Stack gap={2} data-testid="search-columns-list">
                {items.map(item => (
                  <Group
                    key={item}
                    justify="space-between"
                    wrap="nowrap"
                    gap="xs"
                  >
                    <Text size="xs" ff="monospace" truncate="end">
                      {item}
                    </Text>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() => removeColumn(item)}
                      aria-label={`Remove ${item}`}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
          </ScrollArea.Autosize>
          <Autocomplete
            size="xs"
            placeholder="Add column"
            value={search}
            onChange={setSearch}
            data={options}
            limit={50}
            onOptionSubmit={addColumn}
            comboboxProps={{ withinPortal: false }}
            data-testid="search-columns-add-input"
          />
        </Stack>
      )}
      renderSql={apply => (
        <div data-testid="search-select-input">
          <SQLInlineEditor
            tableConnection={tableConnection}
            value={draft}
            onChange={setDraft}
            placeholder={defaultValue || 'SELECT Columns'}
            onSubmit={apply}
            label="SELECT"
            size="xs"
            allowMultiline
            dateRange={dateRange}
            sourceId={sourceId}
          />
        </div>
      )}
    />
  );
}
