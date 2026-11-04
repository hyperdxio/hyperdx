/**
 * The expanded row's Overview tab must not claim an event has no body while
 * the row query is still in flight (HDX-5442). Holding the row query open
 * keeps the panel in its loading state for as long as the assertions need,
 * so no timing assumptions are involved.
 */
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../../utils/constants';

test.describe('Expanded row body loading state', { tag: '@search' }, () => {
  test('shows a loading placeholder, then the body, and never the empty-body copy', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
    await searchPage.timePicker.selectRelativeTime('Last 1 hour');
    await searchPage.table.waitForRowsToPopulate();

    let releaseRowQuery = () => {};
    const rowQueryReleased = new Promise<void>(resolve => {
      releaseRowQuery = resolve;
    });

    // The full-row query is the only one that aliases the body column.
    await page.route('**/api/clickhouse-proxy**', async route => {
      if ((route.request().postData() ?? '').includes('__hdx_body')) {
        await rowQueryReleased;
      }
      await route.continue();
    });

    await searchPage.table.expandRow(0);
    await searchPage.table.openExpandedRowTab('overview');

    await expect(searchPage.table.expandedRowBodyLoading).toBeVisible();
    await expect(searchPage.table.expandedRowEmptyBody).toBeHidden();

    releaseRowQuery();

    await expect(searchPage.table.expandedRowBody).toBeVisible();
    await expect(searchPage.table.expandedRowBodyLoading).toBeHidden();
    await expect(searchPage.table.expandedRowEmptyBody).toBeHidden();
  });
});
