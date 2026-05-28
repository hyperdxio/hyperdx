import { SearchPage } from '../../page-objects/SearchPage';
import { SERVICES } from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../../utils/constants';

test.describe('Search Filters', { tag: ['@search'] }, () => {
  let searchPage: SearchPage;
  // Using known seeded data - 'info' severity always exists in test data
  const TEST_FILTER_GROUP = 'SeverityText';
  const TEST_FILTER_VALUE = 'info';

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.filters.openFilterGroup(TEST_FILTER_GROUP);
  });

  test('Should apply filters', async () => {
    // Apply the filter using component method
    const filterInput = searchPage.filters.getFilterCheckboxInput(
      TEST_FILTER_GROUP,
      TEST_FILTER_VALUE,
    );
    await expect(filterInput).toBeVisible();

    await searchPage.filters.applyFilter(TEST_FILTER_GROUP, TEST_FILTER_VALUE);

    // Verify filter is checked
    await expect(filterInput).toBeChecked();

    // Verify search results are visible (filters applied)
    await expect(searchPage.getSearchResultsTable()).toBeVisible();
  });

  test('Should exclude filters', async () => {
    // Use filter component to exclude the filter
    await searchPage.filters.excludeFilter(
      TEST_FILTER_GROUP,
      TEST_FILTER_VALUE,
    );

    // Verify filter shows as excluded using web-first assertion
    const isExcluded = await searchPage.filters.isFilterExcluded(
      TEST_FILTER_GROUP,
      TEST_FILTER_VALUE,
    );
    expect(isExcluded).toBe(true);
  });

  test('Should clear filters', async () => {
    await searchPage.filters.clearFilter(TEST_FILTER_GROUP, TEST_FILTER_VALUE);

    // Verify filter is no longer checked
    const filterInput = searchPage.filters.getFilterCheckboxInput(
      TEST_FILTER_GROUP,
      TEST_FILTER_VALUE,
    );
    await expect(filterInput).not.toBeChecked();
  });

  test('Should search for and apply filters', async () => {
    await searchPage.filters.openFilterGroup(TEST_FILTER_GROUP);
    await searchPage.filters.searchFilterValues(TEST_FILTER_GROUP, 'test');
    const searchInput =
      searchPage.filters.getFilterSearchInput(TEST_FILTER_GROUP);
    await expect(searchInput).toHaveValue('test');
    await searchPage.filters.clearFilterSearch(TEST_FILTER_GROUP);
    await expect(searchInput).toHaveValue('');
  });

  test('Should pin filter and verify it persists after reload', async () => {
    await searchPage.filters.pinFilter(TEST_FILTER_GROUP, TEST_FILTER_VALUE);

    // Reload page and wait for search results to populate
    await searchPage.page.reload();
    await searchPage.table.waitForRowsToPopulate();

    // After reload the pinned field should auto-expand; open it explicitly
    // in case it hasn't expanded yet (handles slower CI environments).
    await searchPage.filters.openFilterGroup(TEST_FILTER_GROUP);

    // Verify filter checkbox is still visible with a generous timeout for CI
    const filterCheckbox = searchPage.filters.getFilterCheckbox(
      TEST_FILTER_GROUP,
      TEST_FILTER_VALUE,
    );
    await expect(filterCheckbox).toBeVisible({ timeout: 15000 });

    // Verify there is a pin icon showing the value is still pinned
    const pinIcon = searchPage.page.getByTestId(
      `filter-checkbox-${TEST_FILTER_GROUP}-${TEST_FILTER_VALUE}-pin-pinned`,
    );
    await expect(pinIcon).toBeVisible({ timeout: 15000 });
  });

  // TODO: Implement these tests following the same pattern
  // test('should pin filter values', async () => {
  //   // Use searchPage.filters.pinFilter()
  // });

  // test('should expand and collapse text filters', async () => {
  //   // Use searchPage.filters.openFilterGroup() and getFilterGroup()
  // });

  // test('should show more and show less filter values', async () => {
  //   // Add methods to FilterComponent for show more/less
  // });
});

// HDX-4254: Preserve compatible filters when switching sources
test.describe(
  'Source switching — filter preservation',
  { tag: ['@search'] },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
      // Start every test on the logs source so the baseline is consistent
      await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
    });

    test('Compatible filter is preserved when switching to a source that shares the column — no toast', async () => {
      // Pick a visible ServiceName value from the seeded candidates
      // (pickVisibleFilterValues also opens the filter group)
      const [serviceName] = await searchPage.filters.pickVisibleFilterValues(
        'ServiceName',
        SERVICES,
        1,
      );

      // Apply the ServiceName filter
      await searchPage.filters.applyFilter('ServiceName', serviceName);
      const filterInput = searchPage.filters.getFilterCheckboxInput(
        'ServiceName',
        serviceName,
      );
      await expect(filterInput).toBeChecked();

      // Switch to E2E Traces — ServiceName also exists on that schema
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();

      // Re-open ServiceName group (it may collapse during source switch)
      await searchPage.filters.openFilterGroup('ServiceName');

      // The filter must still be in the URL — implementation contract for HDX-4254.
      // We assert the URL rather than the sidebar checkbox because the trace source
      // may render a different set of facet values (e.g. different service names),
      // making a checkbox-checked assertion fragile even when the filter is correctly
      // preserved in state. The URL is the authoritative source of truth here.
      await expect(searchPage.page).toHaveURL(/filters=.*ServiceName/i);

      // ServiceName exists on both sources, so the pill stays active (not inactive).
      await expect(searchPage.getInactiveFilterPill('ServiceName')).toHaveCount(
        0,
      );
    });

    test('Incompatible filter is preserved as inactive when one of two filters does not exist on new source', async () => {
      // Apply a ServiceName filter (shared between logs and traces)
      // (pickVisibleFilterValues also opens the filter group)
      const [serviceName] = await searchPage.filters.pickVisibleFilterValues(
        'ServiceName',
        SERVICES,
        1,
      );
      await searchPage.filters.applyFilter('ServiceName', serviceName);

      // Open and apply a SeverityText filter (logs-only column, not present on traces)
      await searchPage.filters.openFilterGroup('SeverityText');
      await searchPage.filters.applyFilter('SeverityText', 'info');
      await expect(
        searchPage.filters.getFilterCheckboxInput('SeverityText', 'info'),
      ).toBeChecked();

      // Switch to E2E Traces — SeverityText does not exist on that schema
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();

      // SeverityText pill is preserved as inactive (data-invalid="true") so the
      // user can switch back without losing context. It is *not* applied to the
      // query — i.e. not in the URL.
      await expect(
        searchPage.getInactiveFilterPill('SeverityText'),
      ).toBeVisible({ timeout: 10000 });
      await expect(searchPage.page).not.toHaveURL(/filters=.*SeverityText/i);

      // The compatible ServiceName filter stays active in URL and is not
      // marked inactive.
      await expect(searchPage.page).toHaveURL(/filters=.*ServiceName/i);
      await expect(searchPage.getInactiveFilterPill('ServiceName')).toHaveCount(
        0,
      );
    });

    test('Filter for a column that does not exist on new source is preserved as inactive', async () => {
      // Open and apply only a SeverityText filter (logs-only, not present on traces)
      await searchPage.filters.openFilterGroup('SeverityText');
      await searchPage.filters.applyFilter('SeverityText', 'info');
      await expect(
        searchPage.filters.getFilterCheckboxInput('SeverityText', 'info'),
      ).toBeChecked();

      // Switch to E2E Traces — SeverityText is absent from traces schema
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();

      // Pill is preserved as inactive (visible but not applied to the query).
      await expect(
        searchPage.getInactiveFilterPill('SeverityText'),
      ).toBeVisible({ timeout: 10000 });
      await expect(searchPage.page).not.toHaveURL(/filters=.*SeverityText/i);
    });

    test('Inactive filter reactivates when switching back to a compatible source', async () => {
      // Apply a SeverityText filter on logs
      await searchPage.filters.openFilterGroup('SeverityText');
      await searchPage.filters.applyFilter('SeverityText', 'info');

      // Switch to traces — pill goes inactive, dropped from URL
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
      await expect(
        searchPage.getInactiveFilterPill('SeverityText'),
      ).toBeVisible({ timeout: 10000 });

      // Switch back to logs — pill should reactivate and re-appear in URL
      await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
      await expect(
        searchPage.getInactiveFilterPill('SeverityText'),
      ).toHaveCount(0);
      await expect(searchPage.page).toHaveURL(/filters=.*SeverityText/i);
    });
  },
);

// HDX-3901: Filter parsing with special characters (=, >, <, OR) in quoted
// values is tested via unit tests in searchFilters.test.ts (6 dedicated test
// cases). The parseQuery / extractInClauses / containsOperatorOutsideQuotes
// functions are pure client-side logic that doesn't require E2E coverage.
