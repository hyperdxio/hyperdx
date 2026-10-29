import { DateRange, TMetricSource } from '@hyperdx/common-utils/dist/types';
import { Box, Flex } from '@mantine/core';

import { useMetricCatalog } from '@/hooks/useMetricCatalog';
import type { MetricCatalogEntry } from '@/utils/metricNameTree';

import { MetricBrowser } from './MetricBrowser';
import { MetricDetailPanel } from './MetricDetailPanel';

/**
 * Width of the catalog pane, as a share of the modal rather than a fixed size.
 *
 * The upper bound is what a long name needs: deep collector names run to ~50
 * characters (`ClickHouseAsyncMetrics_BlockDiscardMerges_nbd0`) and the type and
 * unit columns take a fixed ~170px out of it. But a fixed width is wrong on a
 * narrow viewport — the modal is itself `min(1500px, 94vw)`, so 580px could end
 * up being three-quarters of it and squeeze the detail pane to nothing. The
 * lower bound keeps the name column legible once the share gets small.
 */
const TREE_PANE_BASIS = 'clamp(300px, 38%, 580px)';

type MetricExplorerProps = {
  metricSource: TMetricSource;
  dateRange?: DateRange['dateRange'];
  /** Highlighted metric. Controlled by the shell so it can seed and commit it. */
  selected: MetricCatalogEntry | null;
  onSelectedChange: (entry: MetricCatalogEntry) => void;
  /** Commit shortcut (double-click a metric). The shell also renders a button. */
  onApply?: (entry: MetricCatalogEntry) => void;
  /** Syntax for clauses handed to `onAddWhere`. @default 'sql' */
  language?: 'sql' | 'lucene';
  /** Omit to browse tags read-only, with no filter or group-by actions. */
  onAddWhere?: (clause: string) => void;
  onAddGroupBy?: (clause: string) => void;
};

/**
 * Browse the metrics a source is reporting: a prefix hierarchy over metric
 * names on the left, and the selected metric's unit, description, and tags on
 * the right.
 *
 * Shell-agnostic on purpose — it renders no modal chrome, owns no form state,
 * and reads no router. `MetricExplorerModal` is the only wrapper today; a
 * standalone page would be another one.
 */
export function MetricExplorer({
  metricSource,
  dateRange,
  selected,
  onSelectedChange,
  onApply,
  language,
  onAddWhere,
  onAddGroupBy,
}: MetricExplorerProps) {
  const { entries, failedKinds, isLoading, error } = useMetricCatalog({
    source: metricSource,
    dateRange,
  });

  return (
    <Flex gap="md" align="stretch" h="100%" style={{ minHeight: 0 }}>
      <Box
        style={{
          flex: `0 0 ${TREE_PANE_BASIS}`,
          minWidth: 0,
          borderRight: '1px solid var(--color-border)',
          paddingRight: 'var(--mantine-spacing-md)',
        }}
      >
        <MetricBrowser
          entries={entries}
          failedKinds={failedKinds}
          isLoading={isLoading}
          error={error}
          selected={selected}
          onSelectedChange={onSelectedChange}
          onApply={onApply}
        />
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <MetricDetailPanel
          metricSource={metricSource}
          metric={selected}
          language={language}
          onAddWhere={onAddWhere}
          onAddGroupBy={onAddGroupBy}
        />
      </Box>
    </Flex>
  );
}
