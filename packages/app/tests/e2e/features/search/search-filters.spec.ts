import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

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

    // Reload page and verify filter persists
    await searchPage.page.reload();

    // Verify filter checkbox is still visible
    const filterCheckbox = searchPage.filters.getFilterCheckbox(
      TEST_FILTER_GROUP,
      TEST_FILTER_VALUE,
    );
    await expect(filterCheckbox).toBeVisible();

    //verify there is a pin icon
    const pinIcon = searchPage.page.getByTestId(
      `filter-checkbox-${TEST_FILTER_GROUP}-${TEST_FILTER_VALUE}-pin-pinned`,
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

test.describe(
  'Search Filters - Special Characters in Values (HDX-3901)',
  { tag: ['@search'] },
  () => {
    function buildSearchUrlWithFilter(condition: string): string {
      const filters = [{ type: 'sql', condition }];
      const encoded = encodeURIComponent(JSON.stringify(filters));
      return `/search?filters=${encoded}`;
    }

    // These tests navigate to the search page with pre-set URL filter params
    // whose values contain special characters. The filter group auto-expands
    // because it has selected values (isDefaultExpanded). We use
    // ensureFilterGroupExpanded to avoid accidentally toggling it closed, then
    // wait with a generous timeout for the filter checkbox to appear (the URL
    // → parseQuery → filterState → re-render cycle can take a few seconds).

    test('Should display filter when value contains = character', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      const filterGroup = 'SeverityText';
      const filterValue = 'key=value';

      await page.goto(
        buildSearchUrlWithFilter(`${filterGroup} IN ('${filterValue}')`),
      );
      await searchPage.filters.ensureFilterGroupExpanded(filterGroup);

      const filterInput = searchPage.filters.getFilterCheckboxInput(
        filterGroup,
        filterValue,
      );
      await expect(filterInput).toBeVisible({ timeout: 15000 });
      await expect(filterInput).toBeChecked();
    });

    test('Should display filter when value contains > character', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      const filterGroup = 'SeverityText';
      const filterValue = 'x > y';

      await page.goto(
        buildSearchUrlWithFilter(`${filterGroup} IN ('${filterValue}')`),
      );
      await searchPage.filters.ensureFilterGroupExpanded(filterGroup);

      const filterInput = searchPage.filters.getFilterCheckboxInput(
        filterGroup,
        filterValue,
      );
      await expect(filterInput).toBeVisible({ timeout: 15000 });
      await expect(filterInput).toBeChecked();
    });

    test('Should display filter when value contains < character', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      const filterGroup = 'SeverityText';
      const filterValue = '<html>';

      await page.goto(
        buildSearchUrlWithFilter(`${filterGroup} IN ('${filterValue}')`),
      );
      await searchPage.filters.ensureFilterGroupExpanded(filterGroup);

      const filterInput = searchPage.filters.getFilterCheckboxInput(
        filterGroup,
        filterValue,
      );
      await expect(filterInput).toBeVisible({ timeout: 15000 });
      await expect(filterInput).toBeChecked();
    });

    test('Should display filter when value contains AND-joined OR text', async ({
      page,
    }) => {
      // Use a compound condition with an AND clause so the OR text is inside
      // a quoted value that is part of a larger condition (mirrors real-world
      // usage). The simple OR case is covered by the parseQuery unit test.
      const searchPage = new SearchPage(page);
      const filterGroup = 'SeverityText';
      const filterValue = 'info';

      await page.goto(
        buildSearchUrlWithFilter(
          `ServiceName = 'a OR b' AND ${filterGroup} IN ('${filterValue}')`,
        ),
      );
      await searchPage.filters.ensureFilterGroupExpanded(filterGroup);

      const filterInput = searchPage.filters.getFilterCheckboxInput(
        filterGroup,
        filterValue,
      );
      await expect(filterInput).toBeVisible({ timeout: 15000 });
      await expect(filterInput).toBeChecked();
    });
  },
);
