import { useMemo, useState } from 'react';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Group,
  Popover,
  SegmentedControl,
  TextInput,
} from '@mantine/core';

import {
  fieldListSummary,
  SplitValueButton,
} from '@/components/SplitValueButton/SplitValueButton';
import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';

import { GroupByFieldList } from './GroupByFieldList';
import {
  defaultSearchGroupBy,
  formatGroupByFields,
  resolveSearchGroupBy,
  SearchGroupByParam,
} from './searchGroupBy';
import { useGroupByKeyOptions } from './useGroupByKeyOptions';

type Mode = 'fields' | 'sql';

export function SearchGroupBySelect({
  source,
  value,
  onApply,
  dateRange,
}: {
  source?: TSource;
  value: SearchGroupByParam;
  onApply: (next: SearchGroupByParam) => void;
  dateRange: [Date, Date];
}) {
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<Mode>('fields');
  const [search, setSearch] = useState('');
  // Fields and SQL tabs edit the same selection; switching tabs converts one
  // draft into the other so edits carry across in both directions.
  const [draft, setDraft] = useState<string[]>([]);
  const [sqlDraft, setSqlDraft] = useState('');
  // Captured on open: live tail moves `dateRange` every refresh, which would
  // refetch the keys and collapse the open list while it reloads.
  const [keysDateRange, setKeysDateRange] = useState(dateRange);

  const { options, tableConnection } = useGroupByKeyOptions({
    source,
    dateRange: keysDateRange,
    enabled: opened,
  });

  const appliedFields = useMemo(
    () => splitAndTrimWithBracket(resolveSearchGroupBy(value, source) ?? ''),
    [value, source],
  );

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(appliedFields);
      setSqlDraft(formatGroupByFields(appliedFields));
      setSearch('');
      setMode('fields');
      setKeysDateRange(dateRange);
    }
    setOpened(next);
  };

  const handleModeChange = (next: string) => {
    if (next === 'sql') {
      setSqlDraft(formatGroupByFields(draft));
      setMode('sql');
    } else {
      setDraft(splitAndTrimWithBracket(sqlDraft));
      setMode('fields');
    }
  };

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Selected entries first, and kept even when absent from the key list so
    // an expression typed in the SQL tab still shows as checked.
    const union = Array.from(new Set([...draft, ...options]));
    return q ? union.filter(f => f.toLowerCase().includes(q)) : union;
  }, [search, draft, options]);

  const commit = (next: SearchGroupByParam) => {
    onApply(next);
    setOpened(false);
  };

  const applyDraft = () =>
    commit(
      formatGroupByFields(
        mode === 'sql' ? splitAndTrimWithBracket(sqlDraft) : draft,
      ),
    );

  const toggleField = (field: string) =>
    setDraft(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field],
    );

  return (
    <Popover
      opened={opened}
      onChange={handleOpenChange}
      position="bottom-start"
      withinPortal
      shadow="md"
      width={420}
    >
      <Popover.Target>
        <SplitValueButton
          name="Group by"
          summary={fieldListSummary(appliedFields)}
          count={appliedFields.length}
          dimmed={value == null}
          onClick={() => handleOpenChange(!opened)}
          data-testid="search-group-by-button"
        />
      </Popover.Target>
      <Popover.Dropdown p="xs" data-testid="search-group-by-dropdown">
        <SegmentedControl
          fullWidth
          size="xs"
          mb="xs"
          value={mode}
          onChange={handleModeChange}
          data={[
            { label: 'Fields', value: 'fields' },
            { label: 'SQL', value: 'sql' },
          ]}
        />
        {mode === 'sql' ? (
          <SQLInlineEditor
            tableConnection={tableConnection}
            value={sqlDraft}
            onChange={setSqlDraft}
            onSubmit={applyDraft}
            placeholder={defaultSearchGroupBy(source) || 'SQL columns'}
            size="xs"
            disableKeywordAutocomplete
            sourceId={source?.id}
            dateRange={keysDateRange}
          />
        ) : (
          <>
            <TextInput
              size="xs"
              placeholder="Search fields"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              mb="xs"
              autoFocus
              data-testid="search-group-by-search"
            />
            <GroupByFieldList
              fields={visibleOptions}
              selected={draft}
              onToggle={toggleField}
            />
          </>
        )}
        <Group gap="xs" mt="xs" justify="space-between">
          <Button variant="subtle" size="xs" onClick={() => commit(null)}>
            Reset to default
          </Button>
          <Group gap="xs">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                setDraft([]);
                setSqlDraft('');
              }}
            >
              Clear
            </Button>
            <Button variant="primary" size="xs" onClick={applyDraft}>
              Apply
            </Button>
          </Group>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
