import { Divider, Group, Stack } from '@mantine/core';

/**
 * Results band for the Explore page. The primary row packs everything a reader
 * scans first into a single dense line: the view switcher, severity summary,
 * and result/scanned-row/elapsed stats on the left, with the columns / sort
 * actions, add-to-dashboard, and the overflow menu pinned to the right. A
 * second row appears only for views that expose an aggregation editor, which
 * is too tall to sit inline. Purely presentational - every piece is passed in
 * as a slot so the page keeps the view-specific logic.
 */
export function ExploreResultsToolbar({
  resultsCount,
  stats,
  filterExpand,
  viewSwitcher,
  viewControls,
  addToDashboard,
  overflowMenu,
  shapeControls,
  shapeActions,
}: {
  resultsCount?: React.ReactNode;
  stats?: React.ReactNode;
  filterExpand?: React.ReactNode;
  viewSwitcher: React.ReactNode;
  /**
   * The one control the current view needs to be read at all, sitting where the
   * switcher's own chart-type picker does. The two never appear together, so
   * the slot beside the switcher always belongs to whichever view is showing.
   */
  viewControls?: React.ReactNode;
  /** "Add to dashboard" action, shown only for chart-tile views. */
  addToDashboard?: React.ReactNode;
  /** Overflow (3-dots) menu holding secondary actions (SQL, export). */
  overflowMenu?: React.ReactNode;
  /** Aggregation / series editor, rendered on its own row below. */
  shapeControls?: React.ReactNode;
  /** Sort / columns adjustments, pinned to the right of the primary row. */
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
          {viewControls}
          {hasStats && <Divider orientation="vertical" my={4} />}
          {stats}
          {resultsCount}
        </Group>
        <Group gap="sm" align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
          {shapeActions}
          {addToDashboard}
          {overflowMenu}
        </Group>
      </Group>
      {shapeControls}
    </Stack>
  );
}
