import { Divider, Group, Stack } from '@mantine/core';

/**
 * Results band for the Explore page. The primary row packs everything a reader
 * scans first into a single dense line: the view switcher, severity summary,
 * and result/scanned-row/elapsed stats on the left, with add-to-dashboard and
 * the overflow menu pinned to the right. A second "shape-the-view" row appears
 * only when the current view exposes controls (aggregation on the left; columns
 * / sort on the right). Purely presentational - every piece is passed in as a
 * slot so the page keeps the view-specific logic.
 */
export function ExploreResultsToolbar({
  resultsCount,
  stats,
  filterExpand,
  viewSwitcher,
  addToDashboard,
  overflowMenu,
  shapeControls,
  shapeActions,
}: {
  resultsCount?: React.ReactNode;
  stats?: React.ReactNode;
  filterExpand?: React.ReactNode;
  viewSwitcher: React.ReactNode;
  /** "Add to dashboard" action, shown only for chart-tile views. */
  addToDashboard?: React.ReactNode;
  /** Overflow (3-dots) menu holding secondary actions (SQL, export). */
  overflowMenu?: React.ReactNode;
  /** Left side of the shape-the-view row: series cards / aggregation. */
  shapeControls?: React.ReactNode;
  /** Right side of the shape-the-view row: sort / columns adjustments. */
  shapeActions?: React.ReactNode;
}) {
  const hasStats = Boolean(resultsCount) || Boolean(stats);
  return (
    <Stack gap={6} w="100%" data-testid="explore-results-toolbar">
      <Group justify="space-between" align="flex-start" w="100%" wrap="nowrap">
        {/* Left cluster wraps to a second line when the row is too narrow so
            the severity pills / stats are never pushed under the actions. */}
        <Group
          gap="sm"
          align="center"
          wrap="wrap"
          style={{ minWidth: 0, flex: 1 }}
        >
          {filterExpand}
          {viewSwitcher}
          {hasStats && <Divider orientation="vertical" my={4} />}
          {stats}
          {resultsCount}
        </Group>
        <Group gap="sm" align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
          {addToDashboard}
          {overflowMenu}
        </Group>
      </Group>
      {(shapeControls != null || shapeActions != null) && (
        <Stack gap="xs" w="100%">
          {shapeControls}
          {shapeActions != null && (
            <Group justify="flex-end" gap="sm" wrap="nowrap">
              {shapeActions}
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
}
