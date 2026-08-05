/**
 * `SELECT *` error state on a Distributed table with a missing shard column
 *
 * The 'E2E Distributed Missing Column' source points at
 * `e2e_otel_logs_distributed`, a Distributed table whose DDL declares
 * `ColumnMissingFromShard` while its target MergeTree table (`e2e_otel_logs`)
 * does not have that column. Listing rows works (the results table selects
 * named columns), but loading a full row does not: the app issues `SELECT *`,
 * the shard rejects the unknown column, and the row-level error state renders
 * with the Known Columns List hint.
 *
 * Both places that load full row data are covered: the row side panel and the
 * inline expanded row.
 */
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { DISTRIBUTED_MISSING_COLUMN_SOURCE_NAME } from '../../utils/constants';

test.describe(
  'SELECT * failure on a Distributed table',
  { tag: '@search' },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(DISTRIBUTED_MISSING_COLUMN_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 hour');
      // Rows still list fine — only the full-row `SELECT *` fails.
      await searchPage.table.waitForRowsToPopulate();
    });

    test('the row side panel shows the Known Columns List hint', async () => {
      await searchPage.table.clickFirstRow();

      await expect(searchPage.sidePanel.container).toBeVisible();
      await expect(searchPage.sidePanel.errorState).toBeVisible();
      await expect(searchPage.sidePanel.knownColumnsListHint).toBeVisible();
      await expect(searchPage.sidePanel.knownColumnsListHint).toContainText(
        'Failed to load row details from distributed or merge table',
      );
      // The hint's remediation: point the user at the source settings, where the
      // Known Columns List lives.
      await expect(
        searchPage.sidePanel.knownColumnsListHint.getByRole('link', {
          name: 'Edit source settings',
        }),
      ).toBeVisible();
    });

    test('the expanded row shows the Known Columns List hint', async () => {
      await searchPage.table.expandRow(0);

      await expect(searchPage.table.expandedRowErrorState).toBeVisible();
      await expect(
        searchPage.table.expandedRowKnownColumnsListHint,
      ).toBeVisible();
      await expect(
        searchPage.table.expandedRowKnownColumnsListHint,
      ).toContainText(
        'Failed to load row details from distributed or merge table',
      );
    });
  },
);
