import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search Filters', { tag: ['@search'] }, () => {
  let searchPage: SearchPage;
  let availableFilterValue: string | null = null;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();

    // Find an available filter value once and reuse across tests
    if (!availableFilterValue) {
      await searchPage.filters.openFilterGroup('SeverityText');

      // Get first visible filter checkbox
      const firstCheckbox = searchPage.page
        .locator('[data-testid^="filter-checkbox-"]')
        .first();
      const testId = await firstCheckbox.getAttribute('data-testid');

      // Extract the value name from data-testid="filter-checkbox-{value}"
      if (testId) {
        availableFilterValue = testId.replace('filter-checkbox-', '');
      }
    }
  });

  test('Should apply filters', async () => {
    // Use filter component to open filter group
    await searchPage.filters.openFilterGroup('SeverityText');

    // Apply the filter using component method
    const filterInput = searchPage.filters.getFilterCheckboxInput(
      availableFilterValue!,
    );
    await expect(filterInput).toBeVisible();

    await searchPage.filters.applyFilter(availableFilterValue!);

    // Verify filter is checked
    await expect(filterInput).toBeChecked();

    // Verify search results are visible (filters applied)
    await expect(searchPage.getSearchResultsTable()).toBeVisible();
  });

  test('Should exclude filters', async () => {
    // Use filter component to exclude the filter
    await searchPage.filters.excludeFilter(availableFilterValue!);

    // Verify filter shows as excluded using web-first assertion
    const isExcluded = await searchPage.filters.isFilterExcluded(
      availableFilterValue!,
    );
    expect(isExcluded).toBe(true);
  });

  test('Should clear filters', async () => {
    await searchPage.filters.clearFilter(availableFilterValue!);

    // Verify filter is no longer checked
    const filterInput = searchPage.filters.getFilterCheckboxInput(
      availableFilterValue!,
    );
    await expect(filterInput).not.toBeChecked();
  });

  test('Should search for and apply filters', async () => {
    // Use filter component's helper to find a filter with search capability
    const skipFilters = ['severity', 'level'];
    const filterName =
      await searchPage.filters.findFilterWithSearch(skipFilters);

    if (filterName) {
      // Search input is already visible from findFilterWithSearch
      // Test the search functionality
      await searchPage.filters.searchFilterValues(filterName, 'test');

      // Verify search input has the value
      const searchInput = searchPage.filters.getFilterSearchInput(filterName);
      await expect(searchInput).toHaveValue('test');

      // Clear the search
      await searchPage.filters.clearFilterSearch(filterName);

      // Verify search input is cleared
      await expect(searchInput).toHaveValue('');
    }
  });

  test('Should pin filter and verify it persists after reload', async () => {
    await searchPage.filters.pinFilter(availableFilterValue!);

    // Reload page and verify filter persists
    await searchPage.page.reload();

    // Verify filter checkbox is still visible
    const filterCheckbox = searchPage.filters.getFilterCheckbox(
      availableFilterValue!,
    );
    await expect(filterCheckbox).toBeVisible();

    //verify there is a pin icon
    const pinIcon = searchPage.page.getByTestId(
      `filter-pin-${availableFilterValue!}-pinned`,
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
