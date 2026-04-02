import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Shared Filters', { tag: ['@search'] }, () => {
  let searchPage: SearchPage;
  const TEST_FILTER_GROUP = 'SeverityText';
  const TEST_FILTER_VALUE = 'info';

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.filters.openFilterGroup(TEST_FILTER_GROUP);
  });

  test('Shared filters section does not appear when no filters are pinned', async () => {
    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeHidden();
  });

  test('Pinning a field shows it in the shared filters section', async () => {
    // Pin a field
    await searchPage.filters.pinField(TEST_FILTER_GROUP);

    // Shared filters section should appear with the pinned field
    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible();
    await expect(sharedSection).toContainText(TEST_FILTER_GROUP);
  });

  test('Pinning a value shows it in the shared filters section', async () => {
    // Pin a specific value
    await searchPage.filters.pinFilter(TEST_FILTER_GROUP, TEST_FILTER_VALUE);

    // Shared filters section should appear
    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible();
    await expect(sharedSection).toContainText(TEST_FILTER_GROUP);
  });

  test('Pinned field persists after page reload', async () => {
    // Pin a field
    await searchPage.filters.pinField(TEST_FILTER_GROUP);

    // Wait for the debounced API write (300ms + network)
    await searchPage.page.waitForTimeout(1000);

    // Reload
    await searchPage.page.reload();

    // Shared filters section should still be visible with the pinned field
    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible({ timeout: 10000 });
    await expect(sharedSection).toContainText(TEST_FILTER_GROUP);
  });

  test('Pinned field is removed from the main filters list', async () => {
    // Pin a field
    await searchPage.filters.pinField(TEST_FILTER_GROUP);

    // The field should appear in shared filters
    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible();

    // The field should NOT appear in the main filters list below
    const mainFilterGroup =
      searchPage.filters.getFilterGroup(TEST_FILTER_GROUP);
    await expect(mainFilterGroup).toBeHidden();
  });

  test('Unpinning a field removes it from the shared filters section', async () => {
    // Pin a field
    await searchPage.filters.pinField(TEST_FILTER_GROUP);

    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible();

    // Unpin the field by clicking the pin icon in the shared filters section
    const sharedGroup = sharedSection.locator(`button[title="Unpin Field"]`);
    await sharedGroup.first().click();

    // Shared filters section should disappear (no more pinned fields)
    await expect(sharedSection).toBeHidden();

    // The field should reappear in the main filters list
    const mainFilterGroup =
      searchPage.filters.getFilterGroup(TEST_FILTER_GROUP);
    await expect(mainFilterGroup).toBeVisible();
  });

  test('Filter settings gear allows toggling shared filters visibility', async () => {
    // Pin a field first so shared filters section appears
    await searchPage.filters.pinField(TEST_FILTER_GROUP);
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

    // The pinned field should reappear in the main filters list
    const mainFilterGroup =
      searchPage.filters.getFilterGroup(TEST_FILTER_GROUP);
    await expect(mainFilterGroup).toBeVisible();
  });

  test('Applying a filter in the shared section works', async () => {
    // Pin a field
    await searchPage.filters.pinField(TEST_FILTER_GROUP);

    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible();

    // Click on a filter value within the shared section
    const filterCheckbox = sharedSection.getByTestId(
      `filter-checkbox-${TEST_FILTER_GROUP}-${TEST_FILTER_VALUE}`,
    );
    await filterCheckbox.click();

    // The filter should be applied — verify the checkbox is checked
    const filterInput = sharedSection.getByTestId(
      `filter-checkbox-${TEST_FILTER_GROUP}-${TEST_FILTER_VALUE}-input`,
    );
    await expect(filterInput).toBeChecked();
  });

  test('Reset shared filters clears all pinned fields', async () => {
    // Pin a field
    await searchPage.filters.pinField(TEST_FILTER_GROUP);
    const sharedSection = searchPage.filters.getSharedFiltersSection();
    await expect(sharedSection).toBeVisible();

    // Open filter settings and click reset
    const settingsButton = searchPage.page.getByRole('button', {
      name: 'Filter settings',
    });
    await settingsButton.click();

    const resetButton = searchPage.page.getByRole('button', {
      name: 'Reset Shared Filters',
    });
    await resetButton.click();

    // Wait for debounced write
    await searchPage.page.waitForTimeout(500);

    // Shared filters section should disappear
    await expect(sharedSection).toBeHidden();
  });
});
