/**
 * Event Patterns sample flyout — Service column (HDX-5274)
 *
 * The 'E2E Generic Logs' source names its service column `AppName` (not the
 * standard `ServiceName`), keeps it out of the backing table's sort key, and
 * aliases it in its default SELECT (`AppName as service`). The Event Patterns
 * view rebuilds its own sample SELECT, so the service only shows up in the
 * flyout's "Sample Events" table if it is selected explicitly under a stable
 * alias — the fix for HDX-5274. Before it, the Service column rendered empty for
 * this shape (it worked elsewhere only because ServiceName happened to be in the
 * sort key and got appended incidentally).
 */
import { SearchPage } from '../../page-objects/SearchPage';
import { CUSTOM_SERVICE_LOGS_APP_NAMES } from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import { CUSTOM_SERVICE_LOGS_SOURCE_NAME } from '../../utils/constants';

// The seeded AppName values are distinct tokens that never appear in a Body, so
// matching any of them in the Service column proves it is populated with the
// service and not accidentally reading another column.
const APP_NAME_PATTERN = new RegExp(CUSTOM_SERVICE_LOGS_APP_NAMES.join('|'));

test.describe(
  'Event Patterns sample flyout',
  { tag: ['@full-stack', '@search'] },
  () => {
    test('renders the service name for a non-standard service column that is not in the sort key', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(CUSTOM_SERVICE_LOGS_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 hour');
      await searchPage.table.waitForRowsToPopulate();
      await expect(searchPage.getTableError()).toHaveCount(0);

      await searchPage.switchToEventPatterns();
      await searchPage.openFirstPattern();

      const panel = searchPage.patternSidePanel;
      await expect(panel.sampleTable).toBeVisible();
      await expect(panel.serviceColumnHeader).toBeVisible();
      await expect(panel.serviceCell(0)).toHaveText(APP_NAME_PATTERN);
    });
  },
);
