import { useCallback, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Modal, Pill, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import type { MetricCatalogEntry } from '@/utils/metricNameTree';

import { MetricExplorer } from './MetricExplorer';

/**
 * Tall enough to browse without constant scrolling, but bounded so the modal
 * still fits a laptop viewport alongside its header and footer.
 */
const EXPLORER_HEIGHT = 'min(68vh, 680px)';

/** Mantine accepts any CSS length for `size`; cap it so it stays readable. */
const MODAL_WIDTH = 'min(1500px, 94vw)';

/** What the explorer hands back when the user commits a metric. */
export type MetricExplorerSelection = {
  name: string;
  type: MetricsDataType;
  /** Tag keys staged for grouping, always SQL. */
  groupBy: string[];
};

type MetricExplorerModalProps = {
  opened: boolean;
  onClose: () => void;
  metricSource: TMetricSource;
  dateRange?: DateRange['dateRange'];
  /** The series' current metric, preselected when the modal opens. */
  value?: { metricName?: string | null; metricType?: MetricsDataType | null };
  /** The series' current condition, so the footer can warn before clearing it. */
  currentWhere?: string;
  /** The chart's current grouping, likewise. */
  currentGroupBy?: string;
  onApply: (selection: MetricExplorerSelection) => void;
};

/**
 * Modal shell around `MetricExplorer`. Owns the pending selection, the tag
 * filters staged against it, and the commit/cancel buttons — so the explorer
 * itself stays reusable outside a modal.
 */
export function MetricExplorerModal({
  opened,
  onClose,
  metricSource,
  dateRange,
  value,
  currentWhere,
  currentGroupBy,
  onApply,
}: MetricExplorerModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Browse metrics"
      size={MODAL_WIDTH}
      data-testid="metric-explorer-modal"
    >
      {/*
        The explorer is an optional, additive surface hanging off the chart
        editor, so a crash in it must not take the editor — or the app — down
        with it. Contained here, at the boundary between the modal shell and
        everything the explorer renders, so the user can still close the modal
        and keep working with the select.
      */}
      <ErrorBoundary
        onError={error => {
          console.error('Metric explorer crashed', error);
        }}
        fallbackRender={() => (
          <Stack align="center" py="xl" gap="xs">
            <Text size="sm">Something went wrong loading the explorer.</Text>
            <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
              Close this dialog and pick a metric from the select instead.
            </Text>
            <Button variant="secondary" onClick={onClose} mt="sm">
              Close
            </Button>
          </Stack>
        )}
      >
        {/*
          Mounted fresh per open (Mantine renders no children while closed), so
          the initial selection is a useState seed rather than a re-seeding
          effect, and cancelling then reopening starts from what is actually
          charted rather than the last uncommitted click.
        */}
        <MetricExplorerModalBody
          metricSource={metricSource}
          dateRange={dateRange}
          value={value}
          currentWhere={currentWhere}
          currentGroupBy={currentGroupBy}
          onClose={onClose}
          onApply={onApply}
        />
      </ErrorBoundary>
    </Modal>
  );
}

function MetricExplorerModalBody({
  metricSource,
  dateRange,
  value,
  currentWhere,
  currentGroupBy,
  onClose,
  onApply,
}: Omit<MetricExplorerModalProps, 'opened'>) {
  const [selected, setSelected] = useState<MetricCatalogEntry | null>(() =>
    value?.metricName && value?.metricType
      ? { name: value.metricName, type: value.metricType }
      : null,
  );
  const [groupBy, setGroupBy] = useState<string[]>([]);

  // A tag key is one metric's, so switching metrics has to drop whatever was
  // staged for the previous one. Compared outside the updater: an impure
  // updater double-fires under StrictMode.
  const handleSelectedChange = useCallback(
    (entry: MetricCatalogEntry) => {
      if (selected?.name !== entry.name || selected?.type !== entry.type) {
        setGroupBy([]);
      }
      setSelected(entry);
    },
    [selected],
  );

  const handleAddGroupBy = useCallback(
    (clause: string) =>
      setGroupBy(prev => (prev.includes(clause) ? prev : [...prev, clause])),
    [],
  );

  const handleApply = (entry: MetricCatalogEntry) => {
    onApply({ name: entry.name, type: entry.type, groupBy });
    onClose();
  };

  // Applying reaches past the metric name into controls the user cannot see
  // from here: the series filter below the card, and a group by that lives in
  // the page toolbar. Neither is visible from the modal, so it has to say what
  // it will take with it before the user commits.
  const isSwap =
    !!selected &&
    (selected.name !== value?.metricName ||
      selected.type !== value?.metricType);
  const notices: string[] = [];
  if (isSwap && currentWhere?.trim()) {
    notices.push("Switching metrics clears the series' filter.");
  }
  if (groupBy.length > 0 && currentGroupBy?.trim()) {
    notices.push("Replaces the chart's group by.");
  }

  return (
    <>
      <Box h={EXPLORER_HEIGHT}>
        <MetricExplorer
          metricSource={metricSource}
          dateRange={dateRange}
          selected={selected}
          onSelectedChange={handleSelectedChange}
          onApply={handleApply}
          onAddGroupBy={handleAddGroupBy}
        />
      </Box>

      <Stack gap="xs" mt="md">
        {groupBy.length > 0 && (
          <Group gap="xs" data-testid="metric-explorer-staged">
            <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
              Applying with
            </Text>
            {groupBy.map(clause => {
              const label = `Group by ${clause}`;
              return (
                <Pill
                  key={clause}
                  size="sm"
                  withRemoveButton
                  // Mantine hides a Pill's remove button from assistive tech
                  // and the tab order, because a Pill is normally decorative
                  // chrome inside an input whose parent owns the interaction.
                  // These chips are the only way to undo a staged clause, so
                  // the button has to be reachable on its own.
                  removeButtonProps={{
                    'aria-hidden': false,
                    tabIndex: 0,
                    'aria-label': `Remove ${label}`,
                  }}
                  onRemove={() =>
                    setGroupBy(prev => prev.filter(c => c !== clause))
                  }
                >
                  {label}
                </Pill>
              );
            })}
          </Group>
        )}
        {notices.length > 0 && (
          <Stack gap={4} data-testid="metric-explorer-overwrites">
            {notices.map(notice => (
              <Group key={notice} gap={6} wrap="nowrap">
                <IconAlertTriangle
                  size={14}
                  style={{
                    flexShrink: 0,
                    color: 'var(--color-text-warning)',
                  }}
                />
                <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
                  {notice}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
        <Group justify="flex-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => selected && handleApply(selected)}
            data-testid="metric-explorer-apply"
          >
            Use this metric
          </Button>
        </Group>
      </Stack>
    </>
  );
}
