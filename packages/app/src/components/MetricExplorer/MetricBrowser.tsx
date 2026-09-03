import { useMemo, useState } from 'react';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import {
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconMoodEmpty,
  IconSearch,
} from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { useLocalStorage } from '@/utils';
import { METRIC_KIND_LABELS } from '@/utils/metricKinds';
import {
  filterMetricEntries,
  type MetricCatalogEntry,
} from '@/utils/metricNameTree';

import { MetricFlatList } from './MetricFlatList';
import { MetricNameTree } from './MetricNameTree';
import { MetricColumnHeader } from './MetricRow';

/** How the catalog is laid out. Remembered across sessions. */
type MetricViewMode = 'tree' | 'list';

const VIEW_MODE_STORAGE_KEY = 'hdx-metric-explorer-view';

/** Stable identity, so the default does not remount consumers each render. */
const NO_FAILED_KINDS: MetricsDataType[] = [];

type MetricBrowserProps = {
  entries: MetricCatalogEntry[];
  /** Kinds whose table could not be read; the catalog is a subset without them. */
  failedKinds?: MetricsDataType[];
  isLoading?: boolean;
  /** Set when the catalog could not be loaded at all. */
  error?: Error | null;
  selected: MetricCatalogEntry | null;
  onSelectedChange: (entry: MetricCatalogEntry) => void;
  /** Commit shortcut, fired on double-clicking a metric. */
  onApply?: (entry: MetricCatalogEntry) => void;
};

/**
 * Search, layout toggle and column header around the catalog, plus whichever
 * body the user picked.
 *
 * The two modes answer different questions. The tree is for "what does this
 * source even report", where the namespace does the organising; the flat list
 * is for "I half-remember the name", where hierarchy is just clicks in the way.
 */
export function MetricBrowser({
  entries,
  failedKinds = NO_FAILED_KINDS,
  isLoading,
  error,
  selected,
  onSelectedChange,
  onApply,
}: MetricBrowserProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 200);
  const isSearching = debouncedSearch.trim().length > 0;

  const [viewMode, setViewMode] = useLocalStorage<MetricViewMode>(
    VIEW_MODE_STORAGE_KEY,
    'tree',
  );

  const filtered = useMemo(
    () => filterMetricEntries(entries, debouncedSearch),
    [entries, debouncedSearch],
  );

  const isEmpty = filtered.length === 0;

  return (
    <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
      <Group gap="xs" wrap="nowrap">
        <TextInput
          size="xs"
          variant="filled"
          placeholder="Search metrics…"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 0 }}
          data-testid="metric-explorer-search"
        />
        <SegmentedControl
          size="xs"
          value={viewMode}
          onChange={value => setViewMode(value as MetricViewMode)}
          data={[
            { label: 'Tree', value: 'tree' },
            { label: 'List', value: 'list' },
          ]}
          data-testid="metric-explorer-view-mode"
        />
      </Group>

      {failedKinds.length > 0 && (
        <Text
          size="xxs"
          style={{ color: 'var(--color-text-warning)' }}
          data-testid="metric-explorer-partial-failure"
        >
          Could not load{' '}
          {failedKinds.map(k => METRIC_KIND_LABELS[k].toLowerCase()).join(', ')}{' '}
          metrics. The list below is incomplete.
        </Text>
      )}

      {!isEmpty && <MetricColumnHeader />}

      {isLoading && entries.length === 0 ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : error ? (
        // Distinct from the empty state: a catalog that failed to load is not a
        // source that reported nothing, and conflating them sends people
        // looking for missing data instead of a broken query.
        <EmptyState
          icon={<IconAlertTriangle size={28} />}
          title="Could not load metrics"
          description={error.message}
          data-testid="metric-explorer-error"
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<IconMoodEmpty size={28} />}
          title={isSearching ? 'No matching metrics' : 'No metrics found'}
          description={
            isSearching
              ? 'Try a shorter or different search term.'
              : 'No metrics were reported to this source recently.'
          }
        />
      ) : viewMode === 'list' ? (
        <MetricFlatList
          entries={filtered}
          selected={selected}
          onSelectedChange={onSelectedChange}
          onApply={onApply}
        />
      ) : (
        <MetricNameTree
          entries={filtered}
          isSearching={isSearching}
          selected={selected}
          onSelectedChange={onSelectedChange}
          onApply={onApply}
        />
      )}
    </Stack>
  );
}
