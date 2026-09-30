import { Box, Group, Text } from '@mantine/core';

import { METRIC_KIND_LABELS } from '@/utils/metricKinds';
import type { MetricCatalogEntry } from '@/utils/metricNameTree';
import { metricUnitShort } from '@/utils/metricUnits';

/**
 * Fixed widths so kind and unit line up into scannable columns regardless of
 * how deeply a row is indented — the name column absorbs the indentation.
 */
const TYPE_COLUMN_WIDTH = 104;
const UNIT_COLUMN_WIDTH = 56;

export const ROW_DIVIDER = '1px solid var(--color-border-muted)';

/** Column header, so the tree and the flat list share one set of labels. */
export function MetricColumnHeader() {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      pb={6}
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <Text
        size="xxs"
        c="dimmed"
        fw={600}
        tt="uppercase"
        style={{ flex: 1, minWidth: 0 }}
      >
        Metric
      </Text>
      <Text size="xxs" c="dimmed" fw={600} tt="uppercase" w={TYPE_COLUMN_WIDTH}>
        Type
      </Text>
      <Text size="xxs" c="dimmed" fw={600} tt="uppercase" w={UNIT_COLUMN_WIDTH}>
        Unit
      </Text>
    </Group>
  );
}

type MetricRowProps = {
  entry: MetricCatalogEntry;
  /**
   * Text to show. The tree passes the trailing name segment; the flat list
   * passes the whole metric name.
   */
  label: string;
  isSelected: boolean;
};

/**
 * The name / type / unit columns of one metric row.
 *
 * Presentation only, with no wrapper element of its own, so the tree can render
 * it inside the row element Mantine hands to `renderNode` (which carries the
 * indentation and click handling) and the flat list can supply its own.
 */
export function MetricRowContent({ entry, label, isSelected }: MetricRowProps) {
  return (
    <>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" truncate>
          {label}
        </Text>
        {entry.description && (
          <Text size="xxs" c="dimmed" truncate mt={1}>
            {entry.description}
          </Text>
        )}
      </Box>
      <Text
        size="xs"
        w={TYPE_COLUMN_WIDTH}
        style={{
          flexShrink: 0,
          color: isSelected
            ? 'var(--color-text-brand)'
            : 'var(--color-text-muted)',
        }}
      >
        {METRIC_KIND_LABELS[entry.type]}
      </Text>
      {/*
        Truncated, not just narrow: stripping UCUM annotation braces yields
        whatever word was inside, and real catalogs carry long ones
        (`{recommendation}`, `{match_attempts}`) that otherwise run past the
        column and get clipped mid-word by the pane edge. The title keeps the
        full value reachable.
      */}
      <Text
        size="xs"
        c="dimmed"
        w={UNIT_COLUMN_WIDTH}
        truncate
        title={entry.unit || undefined}
        style={{ flexShrink: 0 }}
      >
        {metricUnitShort(entry.unit)}
      </Text>
    </>
  );
}

/** Row styling shared by both modes: divider, plus a left rule when selected. */
export function metricRowStyle(isSelected: boolean): React.CSSProperties {
  return {
    borderBottom: ROW_DIVIDER,
    // A left rule marks the selection without tinting the whole row, so the
    // metric name stays the highest-contrast thing on it.
    boxShadow: isSelected
      ? 'inset 2px 0 0 0 var(--color-text-brand)'
      : undefined,
  };
}
