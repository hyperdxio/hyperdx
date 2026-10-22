import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Group,
  type RenderTreeNodePayload,
  ScrollArea,
  Stack,
  Text,
  Tree,
  useTree,
} from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';

import {
  ancestorGroupValues,
  buildMetricNameTree,
  collectGroupValues,
  type MetricCatalogEntry,
  metricLeafValue,
} from '@/utils/metricNameTree';

import { MetricRowContent, metricRowStyle, ROW_DIVIDER } from './MetricRow';

/**
 * Cap on leaves while searching, where the whole result is force-expanded and a
 * one-character query would otherwise render the entire catalog at once.
 *
 * Deliberately NOT applied to the unfiltered tree. Mantine renders only the
 * nodes of *expanded* branches, so a collapsed catalog costs one node per root
 * however large it is — and capping it there would drop whole namespaces
 * (truncation takes the alphabetical prefix, so on a real 2,900-metric catalog
 * everything after the Cs simply vanished from the tree).
 */
const MAX_SEARCH_RESULT_LEAVES = 800;

type MetricNameTreeProps = {
  /** Already filtered by the browser's search box. */
  entries: MetricCatalogEntry[];
  isSearching: boolean;
  selected: MetricCatalogEntry | null;
  onSelectedChange: (entry: MetricCatalogEntry) => void;
  /** Commit shortcut, fired on double-clicking a metric. */
  onApply?: (entry: MetricCatalogEntry) => void;
};

/** The catalog as a prefix hierarchy over metric names. */
export function MetricNameTree({
  entries,
  isSearching,
  selected,
  onSelectedChange,
  onApply,
}: MetricNameTreeProps) {
  const { nodes, leafIndex, leafCount, truncatedLeafCount } = useMemo(
    () =>
      buildMetricNameTree(entries, {
        maxLeaves: isSearching ? MAX_SEARCH_RESULT_LEAVES : undefined,
      }),
    [entries, isSearching],
  );

  // Controlled expand/select state. Owning it here means the effects below
  // call stable setState functions rather than the `useTree` controller, whose
  // identity changes every render — which is what previously forced
  // exhaustive-deps to be suppressed.
  // Seeded from the incoming selection rather than synced by an effect. The
  // modal remounts this subtree per open, and mode switches remount it too, so
  // the seed is re-evaluated exactly when a new external selection can appear;
  // afterwards Mantine owns the state through the change handlers below.
  // (Mantine's TreeExpandedState is not re-exported; it is exactly this shape.)
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(
    () =>
      selected
        ? Object.fromEntries(
            ancestorGroupValues(selected.name).map(v => [v, true]),
          )
        : {},
  );
  const [selectedState, setSelectedState] = useState<string[]>(() =>
    selected ? [metricLeafValue(selected)] : [],
  );

  const tree = useTree({
    expandedState,
    onExpandedStateChange: setExpandedState,
    selectedState,
    onSelectedStateChange: setSelectedState,
  });

  // A search result is only useful expanded; collapse again when it clears.
  // Gated on a genuine searching -> not-searching transition, so a catalog
  // arriving late (or a background refetch) never snaps shut branches the user
  // opened by hand, nor the one auto-opened for a preselected metric.
  const wasSearchingRef = useRef(false);
  useEffect(() => {
    if (isSearching) {
      setExpandedState(
        Object.fromEntries(collectGroupValues(nodes).map(v => [v, true])),
      );
    } else if (wasSearchingRef.current) {
      setExpandedState({});
    }
    wasSearchingRef.current = isSearching;
  }, [isSearching, nodes]);

  const renderNode = ({
    node,
    expanded,
    hasChildren,
    // Renamed: `selected` would shadow the prop of the same name.
    selected: isSelected,
    elementProps,
  }: RenderTreeNodePayload) => {
    const entry = leafIndex.get(node.value);

    if (hasChildren || !entry) {
      const rawLeafCount: unknown = node.nodeProps?.leafCount;
      const leafTotal =
        typeof rawLeafCount === 'number' ? rawLeafCount : undefined;
      return (
        <Group
          gap={8}
          wrap="nowrap"
          {...elementProps}
          py={7}
          style={{ ...elementProps.style, borderBottom: ROW_DIVIDER }}
        >
          <IconChevronRight
            size={13}
            style={{
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 150ms',
              flexShrink: 0,
              color: 'var(--color-text-muted)',
            }}
          />
          {/* Weight 500 matches the filter sidebar's group headers; depth is
              carried by indentation, so nesting does not need extra weight. */}
          <Text size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
            {node.label}
          </Text>
          {leafTotal != null && (
            <Text size="xxs" c="dimmed" style={{ flexShrink: 0 }}>
              {leafTotal === 1 ? '1 metric' : `${leafTotal} metrics`}
            </Text>
          )}
        </Group>
      );
    }

    return (
      <Group
        gap="sm"
        wrap="nowrap"
        align="center"
        {...elementProps}
        onClick={event => {
          elementProps.onClick(event);
          onSelectedChange(entry);
        }}
        onDoubleClick={() => onApply?.(entry)}
        py={8}
        title={entry.name}
        style={{
          // No Mantine `pl`/`pr` props here: Mantine carries each node's
          // indentation in `padding-inline-start: var(--label-offset)` on this
          // very element, and a Mantine padding prop emits an inline style that
          // silently overrides it — which flattened every leaf to one depth.
          ...elementProps.style,
          ...metricRowStyle(isSelected),
        }}
      >
        <MetricRowContent
          entry={entry}
          label={String(node.label)}
          isSelected={isSelected}
        />
      </Group>
    );
  };

  return (
    <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Tree
          data={nodes}
          tree={tree}
          levelOffset="md"
          selectOnClick
          renderNode={renderNode}
          data-testid="metric-explorer-tree"
        />
      </ScrollArea>

      {truncatedLeafCount > 0 && (
        <Box>
          <Text size="xxs" style={{ color: 'var(--color-text-muted)' }}>
            Showing the first {leafCount} of {leafCount + truncatedLeafCount}{' '}
            matches. Narrow your search to see the rest.
          </Text>
        </Box>
      )}
    </Stack>
  );
}
