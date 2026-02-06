import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search Filters', { tag: ['@search'] }, () => {
  let searchPage: SearchPage;
  // Using known seeded data - 'info' severity always exists in test data
  const TEST_FILTER_VALUE = 'info';

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.filters.openFilterGroup('SeverityText');
  });

  test('Should apply filters', async () => {
    // Apply the filter using component method
    const filterInput =
      searchPage.filters.getFilterCheckboxInput(TEST_FILTER_VALUE);
    await expect(filterInput).toBeVisible();

    await searchPage.filters.applyFilter(TEST_FILTER_VALUE);

    // Verify filter is checked
    await expect(filterInput).toBeChecked();

    // Verify search results are visible (filters applied)
    await expect(searchPage.getSearchResultsTable()).toBeVisible();
  });

  test('Should exclude filters', async () => {
    // Use filter component to exclude the filter
    await searchPage.filters.excludeFilter(TEST_FILTER_VALUE);

    // Verify filter shows as excluded using web-first assertion
    const isExcluded =
      await searchPage.filters.isFilterExcluded(TEST_FILTER_VALUE);
    expect(isExcluded).toBe(true);
  });

  test('Should clear filters', async () => {
    await searchPage.filters.clearFilter(TEST_FILTER_VALUE);

    // Verify filter is no longer checked
    const filterInput =
      searchPage.filters.getFilterCheckboxInput(TEST_FILTER_VALUE);
    await expect(filterInput).not.toBeChecked();
  });

  test('Should search for and apply filters', async () => {
    const filterName = 'SeverityText';
    await searchPage.filters.openFilterGroup(filterName);
    await searchPage.filters.searchFilterValues(filterName, 'test');
    const searchInput = searchPage.filters.getFilterSearchInput(filterName);
    await expect(searchInput).toHaveValue('test');
    await searchPage.filters.clearFilterSearch(filterName);
    await expect(searchInput).toHaveValue('');
  });

  test('Should pin filter and verify it persists after reload', async () => {
    await searchPage.filters.pinFilter(TEST_FILTER_VALUE);

    // Reload page and verify filter persists
    await searchPage.page.reload();

    // Verify filter checkbox is still visible
    const filterCheckbox =
      searchPage.filters.getFilterCheckbox(TEST_FILTER_VALUE);
    await expect(filterCheckbox).toBeVisible();

    //verify there is a pin icon
    const pinIcon = searchPage.page.getByTestId(
      `filter-pin-${TEST_FILTER_VALUE}-pinned`,
    );
    await expect(pinIcon).toBeVisible();
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
