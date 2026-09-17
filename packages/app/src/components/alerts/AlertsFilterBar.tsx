import { AlertSource, AlertState } from '@hyperdx/common-utils/dist/types';
import { MAX_ALERT_DISPLAY_NAME_LENGTH } from '@hyperdx/common-utils/dist/types';
import {
  Flex,
  Loader,
  SegmentedControl,
  Select,
  TextInput,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import {
  ALERT_SOURCE_FILTER_OPTIONS,
  ALERT_STATE_FILTER_OPTIONS,
} from '@/utils/alerts';

type AlertsFilterBarProps = {
  search: string | null;
  onSearchChange: (value: string | null) => void;
  state: AlertState | null;
  onStateChange: (value: AlertState | null) => void;
  source: AlertSource | null;
  onSourceChange: (value: AlertSource | null) => void;
  tag: string | null;
  onTagChange: (value: string | null) => void;
  tags: string[];
  mine: boolean;
  onMineChange: (value: boolean) => void;
  /** Hidden when there is no signed-in user to scope "my alerts" to. */
  canFilterByCreator: boolean;
  /** Shows a spinner in the search field while a filter change is in flight. */
  isSettling: boolean;
};

export function AlertsFilterBar({
  search,
  onSearchChange,
  state,
  onStateChange,
  source,
  onSourceChange,
  tag,
  onTagChange,
  tags,
  mine,
  onMineChange,
  canFilterByCreator,
  isSettling,
}: AlertsFilterBarProps) {
  return (
    <Flex
      align="center"
      mt="md"
      gap="sm"
      wrap="wrap"
      data-testid="alerts-filters"
    >
      <TextInput
        placeholder="Search by name"
        leftSection={<IconSearch size={16} />}
        rightSection={isSettling ? <Loader size="xs" /> : null}
        value={search ?? ''}
        onChange={e => onSearchChange(e.currentTarget.value || null)}
        maxLength={MAX_ALERT_DISPLAY_NAME_LENGTH}
        miw={200}
        data-testid="alerts-search-input"
        flex={1}
      />
      <Select
        placeholder="Filter by state"
        data={ALERT_STATE_FILTER_OPTIONS}
        value={state}
        onChange={value => onStateChange(value)}
        clearable
        style={{ maxWidth: 180 }}
        data-testid="alerts-state-filter"
      />
      <Select
        placeholder="Filter by source"
        data={ALERT_SOURCE_FILTER_OPTIONS}
        value={source}
        onChange={value => onSourceChange(value)}
        clearable
        style={{ maxWidth: 180 }}
        data-testid="alerts-source-filter"
      />
      {tags.length > 0 && (
        <Select
          placeholder="Filter by tag"
          data={tags}
          value={tag}
          onChange={value => onTagChange(value)}
          clearable
          searchable
          style={{ maxWidth: 200 }}
          data-testid="alerts-tag-filter"
        />
      )}
      {canFilterByCreator && (
        <SegmentedControl
          size="xs"
          data={[
            { value: 'all', label: 'All alerts' },
            { value: 'mine', label: 'Created by me' },
          ]}
          value={mine ? 'mine' : 'all'}
          onChange={value => onMineChange(value === 'mine')}
          data-testid="alerts-creator-filter"
        />
      )}
    </Flex>
  );
}
