import { SearchPage } from '../../page-objects/SearchPage';
import { getApiUrl, getSources } from '../../utils/api-helpers';
import { expect, test } from '../../utils/base-test';

// Serial: all tests write to the same MongoDB document (team pinned filters).
// Parallel execution causes beforeEach resets to race with ongoing mutations.
test.describe.serial(
  'Shared Filters',
  { tag: ['@search', '@full-stack'] },
  () => {
    let searchPage: SearchPage;
    const TEST_FILTER_GROUP = 'SeverityText';
    const TEST_FILTER_VALUE = 'info';

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);

      // Navigate to a neutral page first so TanStack Query cache is not
      // carrying stale data from any previous test.
      await page.goto('/');
      const sources = await getSources(page, 'log');
      const sourceId = sources[0]._id;

      // Reset team pinned filters via API
      await page.request.put(`${getApiUrl()}/pinned-filters`, {
        data: { source: sourceId, fields: [], filters: {} },
      });

      await searchPage.goto();

      // Confirm the Shared Filters section is hidden before proceeding
      await expect(searchPage.filters.getSharedFiltersSection()).toBeHidden({
        timeout: 10000,
      });

      await searchPage.filters.openFilterGroup(TEST_FILTER_GROUP);
    });

    test('Shared filters section does not appear when no filters are pinned', async () => {
      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeHidden();
    });

    test('Sharing a field with team shows it in the shared filters section', async () => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);

      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();
      await expect(sharedSection).toContainText(TEST_FILTER_GROUP);
    });

    test('Shared field persists after page reload', async ({ page }) => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);

      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();
      await expect(sharedSection).toContainText(TEST_FILTER_GROUP);

      // Poll the API until the debounced write has landed on the server
      const sources = await getSources(page, 'log');
      const sourceId = sources[0]._id;
      await expect
        .poll(
          async () => {
            const resp = await page.request.get(
              `${getApiUrl()}/pinned-filters?source=${sourceId}`,
            );
            const data = await resp.json();
            return data?.team?.fields?.length ?? 0;
          },
          { timeout: 10000 },
        )
        .toBeGreaterThan(0);

      // Reload and wait for page to load
      await searchPage.goto();

      // Shared filters section should still be visible with the pinned field
      const sharedSectionAfterReload =
        searchPage.filters.getSharedFiltersSection();
      await expect(sharedSectionAfterReload).toBeVisible({ timeout: 15000 });
      await expect(sharedSectionAfterReload).toContainText(TEST_FILTER_GROUP);
    });

    test('Shared field is removed from the main filters list', async () => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);

      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();

      // The field should NOT appear in the main filters list below
      const mainFilterGroup =
        searchPage.filters.getFilterGroup(TEST_FILTER_GROUP);
      await expect(mainFilterGroup).toBeHidden();
    });

    test('Unsharing a field removes it from the shared filters section', async () => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);

      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();

      // Unshare the field via the PinShareMenu dropdown
      await searchPage.filters.unshareField(TEST_FILTER_GROUP);

      // Shared filters section should disappear (no more shared fields)
      await expect(sharedSection).toBeHidden();

      // The field should reappear in the main filters list
      const mainFilterGroup =
        searchPage.filters.getFilterGroup(TEST_FILTER_GROUP);
      await expect(mainFilterGroup).toBeVisible();
    });

    test('Filter settings gear allows toggling shared filters visibility', async () => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);
      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();

      // Open filter settings
      const settingsButton = searchPage.page.getByRole('button', {
        name: 'Filter settings',
      });
      await settingsButton.click();

      // Uncheck "Show Shared Filters"
      const showSharedCheckbox = searchPage.page.getByRole('checkbox', {
        name: 'Show Shared Filters',
      });
      await showSharedCheckbox.click();

      // Shared filters section should be hidden
      await expect(sharedSection).toBeHidden();

      // The shared field should reappear in the main filters list
      const mainFilterGroup =
        searchPage.filters.getFilterGroup(TEST_FILTER_GROUP);
      await expect(mainFilterGroup).toBeVisible();
    });

    test('Applying a filter in the shared section works', async () => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);

      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();

      // Click on a filter value within the shared section
      const filterCheckbox = sharedSection.getByTestId(
        `filter-checkbox-${TEST_FILTER_GROUP}-${TEST_FILTER_VALUE}`,
      );
      await expect(filterCheckbox).toBeVisible({ timeout: 10000 });
      await filterCheckbox.click();

      // The filter should be applied — verify the checkbox is checked
      const filterInput = sharedSection.getByTestId(
        `filter-checkbox-${TEST_FILTER_GROUP}-${TEST_FILTER_VALUE}-input`,
      );
      await expect(filterInput).toBeChecked({ timeout: 10000 });
    });

    test('Reset shared filters clears all shared fields', async () => {
      await searchPage.filters.shareFieldWithTeam(TEST_FILTER_GROUP);
      const sharedSection = searchPage.filters.getSharedFiltersSection();
      await expect(sharedSection).toBeVisible();

      // Open filter settings and click reset
      const settingsButton = searchPage.page.getByRole('button', {
        name: 'Filter settings',
      });
      await settingsButton.click();

      // Click "Reset Shared Filters" — this opens a confirmation
      await searchPage.page
        .getByText('Reset Shared Filters', { exact: true })
        .click();

      // Click "Confirm" to actually execute the reset
      await searchPage.page.getByText('Confirm', { exact: true }).click();

      // Shared filters section should disappear after the reset takes effect
      await expect(sharedSection).toBeHidden({ timeout: 5000 });
    });
  },
);
