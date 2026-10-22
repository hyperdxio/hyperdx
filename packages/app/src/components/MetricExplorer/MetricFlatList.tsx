import { Group } from '@mantine/core';

import { useVirtualList } from '@/hooks/useVirtualList';
import {
  type MetricCatalogEntry,
  metricLeafValue,
} from '@/utils/metricNameTree';

import { MetricRowContent, metricRowStyle } from './MetricRow';

/**
 * Two lines of text plus padding. Only an estimate — the virtualizer measures
 * real rows as they mount, so a metric without a description still sizes right.
 */
const ESTIMATED_ROW_HEIGHT = 46;

type MetricFlatListProps = {
  entries: MetricCatalogEntry[];
  selected: MetricCatalogEntry | null;
  onSelectedChange: (entry: MetricCatalogEntry) => void;
  onApply?: (entry: MetricCatalogEntry) => void;
};

/**
 * Every metric as one flat, alphabetical list of full names.
 *
 * The counterpart to the tree: no hierarchy to expand, so a name you already
 * know is one scroll or one search away. Virtualized rather than capped,
 * because the whole point is that nothing is hidden — a real catalog runs to
 * thousands of names and the tree only gets away with rendering all of it
 * because collapsed branches cost one node each.
 */
export function MetricFlatList({
  entries,
  selected,
  onSelectedChange,
  onApply,
}: MetricFlatListProps) {
  const selectedValue = selected ? metricLeafValue(selected) : null;

  const {
    containerRef,
    rowVirtualizer,
    virtualItems,
    paddingTop,
    paddingBottom,
  } = useVirtualList(entries.length, ESTIMATED_ROW_HEIGHT);

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', overflow: 'auto' }}
      data-testid="metric-explorer-list"
    >
      {paddingTop > 0 && <div style={{ height: paddingTop }} />}
      {virtualItems.map(virtualRow => {
        const entry = entries[virtualRow.index];
        if (!entry) return null;
        const isSelected = metricLeafValue(entry) === selectedValue;
        return (
          <Group
            key={metricLeafValue(entry)}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            gap="sm"
            wrap="nowrap"
            align="center"
            py={8}
            px="xs"
            title={entry.name}
            onClick={() => onSelectedChange(entry)}
            onDoubleClick={() => onApply?.(entry)}
            style={{ cursor: 'pointer', ...metricRowStyle(isSelected) }}
          >
            <MetricRowContent
              entry={entry}
              label={entry.name}
              isSelected={isSelected}
            />
          </Group>
        );
      })}
      {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
    </div>
  );
}
