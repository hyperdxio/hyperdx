import { useState } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  Autocomplete,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { IconArrowsSort } from '@tabler/icons-react';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { parseAsSortingStateString } from '@/utils/queryParsers';

import { ClausePopover } from './ClausePopover';

const DIRECTION_OPTIONS = [
  { label: 'Asc', value: 'asc' },
  { label: 'Desc', value: 'desc' },
];

/** A single `field ASC|DESC` key, or null for anything the picker can't edit. */
function parseSimpleSort(orderBy: string) {
  const parsed = parseAsSortingStateString.parse(orderBy);
  if (
    parsed == null ||
    parsed.id.startsWith('(') ||
    splitAndTrimWithBracket(orderBy).length !== 1
  ) {
    return null;
  }
  return parsed;
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
  const [draft, setDraft] = useState(value);

  const current = parseSimpleSort(value || defaultValue);
  const parsed = parseSimpleSort(draft || defaultValue);
  const [field, setField] = useState(parsed?.id ?? '');

  const setPick = (id: string, desc: boolean) => {
    setField(id);
    if (id.trim()) {
      setDraft(parseAsSortingStateString.serialize({ id: id.trim(), desc }));
    }
  };

  return (
    <ClausePopover
      label={
        current != null
          ? `Sort: ${current.id} ${current.desc ? 'desc' : 'asc'}`
          : 'Sort'
      }
      title={value || defaultValue}
      icon={<IconArrowsSort size={14} />}
      initialMode={current != null ? 'pick' : 'sql'}
      onOpen={() => {
        setDraft(value);
        setField(current?.id ?? '');
      }}
      onApply={() => onApply(draft)}
      data-testid="search-sort-button"
      renderPick={() => (
        <Stack gap="xs">
          {parsed == null && (
            <Text size="xs" c="dimmed" data-testid="search-sort-custom">
              Custom sort. Edit it in SQL, or pick a field to replace it.
            </Text>
          )}
          <Group gap="xs" wrap="nowrap" align="flex-end">
            <Autocomplete
              size="xs"
              label="Field"
              placeholder="Field"
              value={field}
              onChange={id => setPick(id, parsed?.desc ?? true)}
              data={fieldOptions}
              limit={50}
              comboboxProps={{ withinPortal: false }}
              style={{ flex: 1 }}
              data-testid="search-sort-field-input"
            />
            <SegmentedControl
              size="xs"
              value={parsed?.desc === false ? 'asc' : 'desc'}
              onChange={direction => setPick(field, direction === 'desc')}
              data={DIRECTION_OPTIONS}
              data-testid="search-sort-direction"
            />
          </Group>
        </Stack>
      )}
      renderSql={apply => (
        <Stack gap={0} data-testid="search-order-by-input">
          <SQLInlineEditor
            tableConnection={tableConnection}
            value={draft}
            onChange={setDraft}
            placeholder={defaultValue}
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
