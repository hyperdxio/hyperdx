import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search Filters', { tag: ['@search'] }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should filter logs by severity level and persist pinned filters', async () => {
    await test.step('Apply Info severity filter', async () => {
      // Use filter component to open filter group
      await searchPage.filters.openFilterGroup('SeverityText');

      // Apply the info filter using component method
      const infoInput = searchPage.filters.getFilterCheckboxInput('info');
      await expect(infoInput).toBeVisible();

      await searchPage.filters.applyFilter('info');

      // Verify filter is checked
      await expect(infoInput).toBeChecked();

      // Verify search results are visible (filters applied)
      await expect(searchPage.getSearchResultsTable()).toBeVisible();
    });

    await test.step('Exclude Info severity level', async () => {
      // Use filter component to exclude the filter
      await searchPage.filters.excludeFilter('info');

      // Verify filter shows as excluded using web-first assertion
      const isExcluded = await searchPage.filters.isFilterExcluded('info');
      expect(isExcluded).toBe(true);
    });

    await test.step('Clear the filter', async () => {
      // Use filter component to clear
      await searchPage.filters.clearFilter('info');

      // Verify filter is no longer checked
      const infoInput = searchPage.filters.getFilterCheckboxInput('info');
      await expect(infoInput).not.toBeChecked();
    });

    await test.step('Test using search to find and apply the filter', async () => {
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

    await test.step('Pin filter and verify it persists after reload', async () => {
      // First exclude the filter, then pin it
      await searchPage.filters.excludeFilter('info');
      await searchPage.filters.pinFilter('info');

      // Reload page and verify filter persists
      await searchPage.page.reload();

      // Verify filter checkbox is still visible
      const infoCheckbox = searchPage.filters.getFilterCheckbox('info');
      await expect(infoCheckbox).toBeVisible();

      // Verify it's still excluded
      const isExcluded = await searchPage.filters.isFilterExcluded('info');
      expect(isExcluded).toBe(true);
    });
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
