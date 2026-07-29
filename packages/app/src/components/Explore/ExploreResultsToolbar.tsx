import { Group, Stack } from '@mantine/core';

/**
 * Results band for the Explore page: a stats line (result/scanned-row counts
 * and elapsed time) above a controls row (view switcher on the left; sort,
 * columns, generated SQL and export on the right). Purely presentational -
 * every piece is passed in as a slot so the page keeps the view-specific logic.
 */
export function ExploreResultsToolbar({
  resultsCount,
  stats,
  filterExpand,
  viewSwitcher,
  addToDashboard,
  sortControl,
  columnsControl,
  overflowMenu,
}: {
  resultsCount?: React.ReactNode;
  stats?: React.ReactNode;
  filterExpand?: React.ReactNode;
  viewSwitcher: React.ReactNode;
  /** "Add to dashboard" action, shown only for chart-tile views. */
  addToDashboard?: React.ReactNode;
  sortControl?: React.ReactNode;
  columnsControl?: React.ReactNode;
  /** Overflow (3-dots) menu holding secondary actions (SQL, export). */
  overflowMenu?: React.ReactNode;
}) {
  return (
    <Stack gap={6} w="100%" data-testid="explore-results-toolbar">
      <Group gap="xs" align="center" wrap="nowrap">
        {resultsCount}
        {stats}
      </Group>
      <Group justify="space-between" align="center" w="100%" wrap="nowrap">
        <Group gap="md" align="center" wrap="nowrap">
          {filterExpand}
          {viewSwitcher}
        </Group>
        <Group gap="sm" align="center" wrap="nowrap">
          {addToDashboard}
          {sortControl}
          {columnsControl}
          {overflowMenu}
        </Group>
      </Group>
    </Stack>
  );
}
